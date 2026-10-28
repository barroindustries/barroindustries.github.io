// tests/partner-data-purge.test.mjs — scripts/partner-data-purge.js: delete the data of the retired external-partner feature
// (specs/PARTNER-REMOVAL-SPEC.md WS-F, with the owner answers of section 8, 2026-10-28).
//
// What must hold (the script hard-deletes Auth users and Firestore docs, so every one of these is a safety property):
//   * SELECTION (pure): a partner is role / team / title 'partner' or the Partners department, trimmed and case-insensitive; an account with an admin
//     role is NEVER taken on a marker alone ("needs a look"); an Auth account whose claim says partner and that has no profile is a partner too.
//     bs_quotes split staff from partner by createdByRole / createdBy / draftBy / the draft_<uid> id / company 'PT', and keep every staff quote
//     (a quote tagged partner but made by a staff account is "needs a look", not deleted). partner_deals all go; the seeded "Partner Deal Process
//     (50/50)" SOP goes (by title) and an unrelated "Partner Dealer ..." SOP stays; approval requests go by agentId or by the deleted quotes; posts by
//     department or author; conversations go when nobody else is in them (wholly partner) or exactly ONE staff member is (a direct staff-partner
//     thread, owner Q4), with their sub-collections; a GROUP chat (two or more staff members) is KEPT and only the partner is taken out of it —
//     the partner's uid leaves the member list and the per-member maps, their own messages and read/typing marks are deleted, a preview that was
//     their words is blanked (coordinator change 2026-10-28); a department channel other than Partners is never touched; per-uid docs, notification
//     items and username docs of the partners go and nobody else's do; job_projects are only reported; Brilliant-Steel-only non-partner accounts
//     are only counted (owner Q3).
//   * The report is COUNTS ONLY: no name, email, phone, price, total, client or message ever reaches the log; uids only behind --show-uids.
//   * A DRY RUN writes nothing at all; --backup writes one file per bucket (+ Auth metadata, no password hash) and manifest.json LAST, reads every
//     file back and checks its sha256 and record count; --apply REFUSES without a backup in the same call, and a backup that fails its read-back stops
//     the run before anything is deleted.
//   * --apply deletes exactly the selected documents (children before parents, in batches of at most 400), then edits the kept group chats (only
//     after the partner's messages in them are gone, so a repeat run can still find them), then the Auth users, then the users docs LAST (so a run
//     that dies half way can be repeated), tolerates an Auth user that is already gone, never touches a staff doc, refuses to remove every account
//     or the last president, and then VERIFIES with fresh reads: anything partner-made that is still there is exit code 2.
//   * The command line checks its arguments before it loads firebase or reads a credential, so a typo can never reach Firebase.
//
// Every fixture is invented (this repository is public). No Firebase, no network: `run` is handed an in-memory fake Firestore + Auth + file system.
//
// Mutation-tested in scratch copies of the script (never in the shared tree): 168 textual mutants, 166 killed, 2 survived by design (below).
//   who is a partner: each of the four arms removed (role, team, title, Partners department), role/title compared without trim or case, the admin guard
//     removed and each of its six roles dropped, the legacy department string / the departments array ignored, Auth-only partners not selected, a stale
//     Auth claim on a staff account selected, knownPartnerUids ignored, the Brilliant-Steel-only count taking partners / ignoring a second department /
//     ignoring the legacy string, Brilliant-Steel-only accounts deleted.
//   bs_quotes: each of the five partner arms removed (createdByRole, createdBy, draftBy, the draft_<uid> id, company PT), role and company compared
//     case-sensitively, 'draft_' matched mid-id, every staff quote selected, the "tagged partner but made by staff" guard removed.
//   other buckets: partner_deals filtered or not selected; the SOP pattern broadened / narrowed / missing the plural, the sops bucket dropped or never read, an
//     untitled SOP matched; approvals and posts with each arm removed; conversations: mixed ones kept (the pre-Q4 default), mixed counted as wholly partner,
//     department-channel handling removed (by type, by id), the Partners channel not selected, every department channel selected, a conversation with no
//     participants selected; job_projects deleted or not reported; usernames with either arm removed; notification items / per-uid docs of ANY uid selected;
//     registry entries dropped.
//   report: names, emails, totals, a message body printed; uids printed without --show-uids (or with emails); counts wrong; the Q3 and SAFETY lines missing.
//   backup: manifest never written / also written first; the read-back skipped; the sha256 check skipped or weak; the overwrite refusals removed (run, writeBackup);
//     the manifest not read back; a password hash exported; Timestamps or references not converted; a doc id losing to a data field; file names; an uid with no
//     Auth account dropped; manifest complete:false; the in-repo guard removed (run, main), case-sensitive, prefix-matching, root-allowed, wrong root.
//   runner: apply truthy / always on / allowed without a backup; a dry run falling through to the delete step; users docs deleted before the Auth accounts;
//     children placed after their parents; Auth skipped / user-not-found intolerant / every error swallowed / run before the data; batches of 500 or unbounded;
//     a bucket skipped; a staff doc deleted; the commit not awaited; every verification line removed one at a time, the verification always passing, unaware of
//     the purged uids, or its exit code dropped; each safety refusal removed; sub-collection discovery switched off (all / non-conversations / no listCollections);
//     per-uid reads off; Auth paging off; collections never read; per-uid docs not loaded; a backup error swallowed; path building and record-id validation errors.
//   command line: the --apply guard removed, the credential read before the arguments, unknown options ignored or exit 0, --backup with no value accepted,
//     the manifest pre-check removed, flags not parsed, --help exiting 1, main not passing --apply / not resolving the directory / not returning the exit code.
// Survivors, by design (redundant defence in depth, unreachable behind an earlier check): the record-count read-back check (the sha256 already covers it); the internal "apply reached the delete step without a complete backup" guard (unreachable behind the earlier throws).
//
// Run with: node --test tests/*.test.mjs

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'partner-data-purge.js');
const {
  select, safetyProblems, bucketsOf, editedOriginals, pathFor, summarize, formatReport,
  groupPartnerChildren, groupEditFor, buildGroupPatch,
  toBackupValue, toBackupRecord, toAuthRecord, makeFileIo, writeBackup,
  run, parseArgs, insideRepo, PER_UID_KEYS,
} = require('../scripts/partner-data-purge.js');
const REPO = path.resolve(__dirname, '..');

// ── small helpers ───────────────────────────────────────────────────────────
const rec = (id, data) => ({ id, data: data || {} });
const tsMemo = new Map();                                                    // one object per instant, so two documents built from the same instant compare deep-equal
const TS = (iso) => { if (!tsMemo.has(iso)) tsMemo.set(iso, { toDate: () => new Date(iso) }); return tsMemo.get(iso); };   // a Firestore Timestamp, as far as the script can tell
const sorted = (a) => a.slice().sort();
const ids = (records) => records.map((r) => r.id).sort();
const deepFreeze = (v) => { if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); Object.values(v).forEach(deepFreeze); } return v; };
function cloneData(v) {                                                      // structuredClone would break the Timestamp-likes
  if (v === null || typeof v !== 'object') return v;
  if (typeof v.toDate === 'function') return v;
  if (Array.isArray(v)) return v.map(cloneData);
  const o = {};
  for (const k of Object.keys(v)) o[k] = cloneData(v[k]);
  return o;
}
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

// ═════════════════════════════════════════════════════════════════════════════
// The invented world. Names, emails, phone numbers, totals, items and message bodies are distinctive so a leak into the log is recognisable.
const PII = [
  'Zelda Quartermain', 'zelda.q@partnerco.example', '+63 917 000 4242', 'Quartermain Steel Corporation', 'Pablo Partnerson', 'pablo@partnerco.example',
  'Tessa Titlemark', 'tessa@partnerco.example', 'Marco Managing', 'marco@barro.example', 'Penny President', 'penny@barro.example', 'Bea Steelworker',
  'Acme Vulcanizing Ltd', '987654.32', '13579', 'Secret widget', 'SECRET-MESSAGE-BODY-xyz', 'Steel coordination', 'Quartermain group', 'px@ghost.example',
  'HASH-abc123', 'SALT-xyz789', '777777', 'Other Client Inc',
];

function worldSeed() {
  const s = {};
  // users
  s['users/pres'] = { role: 'president', displayName: 'Penny President', email: 'penny@barro.example', departments: ['Admin'] };
  s['users/mgr'] = { role: 'manager', displayName: 'Mara Manager', email: 'mara@barro.example', departments: ['Sales'] };
  s['users/emp1'] = { role: 'employee', displayName: 'Eli Employee', email: 'eli@barro.example', departments: ['Sales'] };
  s['users/emp2'] = { role: 'agent', displayName: 'Ana Agent', email: 'ana@barro.example', departments: ['Sales'] };
  s['users/p1'] = { role: 'partner', team: 'partner', displayName: 'Zelda Quartermain', email: 'zelda.q@partnerco.example', phone: '+63 917 000 4242', company: 'Quartermain Steel Corporation', departments: ['Brilliant Steel'], createdAt: TS('2026-01-02T03:04:05.000Z') };
  s['users/p2'] = { role: 'Partner', displayName: 'Pablo Partnerson', email: 'pablo@partnerco.example', departments: ['Partners'] };
  s['users/p3'] = { role: 'employee', title: ' PARTNER ', displayName: 'Tessa Titlemark', email: 'tessa@partnerco.example', departments: ['Sales'] };       // title only
  s['users/adm'] = { role: 'manager', title: 'Partner', displayName: 'Marco Managing', email: 'marco@barro.example', departments: ['Admin'] };               // admin + marker -> needs a look
  s['users/bsx'] = { role: 'employee', displayName: 'Bea Steelworker', email: 'bea@barro.example', departments: ['Brilliant Steel'] };                       // Q3: BS-only, not a partner
  s['users/bsy'] = { role: 'employee', displayName: 'Ben Both', email: 'ben@barro.example', departments: ['Brilliant Steel', 'Sales'] };                      // two departments: not BS-only
  // bs_quotes
  const qd = (extra) => Object.assign({ company: 'BS', clientName: 'Acme Vulcanizing Ltd', total: 987654.32, items: [{ desc: 'Secret widget', price: 13579 }], createdAt: TS('2026-03-04T05:06:07.000Z') }, extra);
  s['bs_quotes/q_role'] = qd({ createdByRole: 'partner', createdBy: 'ghostA' });          // role alone, creator unknown
  s['bs_quotes/q_p1'] = qd({ createdByRole: 'partner', createdBy: 'p1' });
  s['bs_quotes/q_p2'] = qd({ createdByRole: 'employee', createdBy: 'p2' });               // the uid says partner, the stamped role does not
  s['bs_quotes/q_pt'] = qd({ company: 'PT', createdByRole: 'zzz', createdBy: 'ghostB' });  // company PT alone
  s['bs_quotes/qd_by'] = qd({ draftBy: 'p2', status: 'draft' });                           // draftBy alone
  s['bs_quotes/draft_p1'] = qd({ draftBy: 'p1' });
  s['bs_quotes/draft_p3'] = qd({});                                                        // the draft_<uid> id alone
  s['bs_quotes/s1'] = qd({ createdByRole: 'employee', createdBy: 'emp1' });                // staff-made: stays
  s['bs_quotes/s2'] = qd({ createdByRole: 'manager', createdBy: 'mgr' });
  s['bs_quotes/s_pres'] = qd({ createdByRole: 'president', createdBy: 'pres' });
  s['bs_quotes/draft_emp1'] = qd({ draftBy: 'emp1' });
  s['bs_quotes/s_mis'] = qd({ createdByRole: 'partner', createdBy: 'emp2' });              // tagged partner, made by staff: needs a look, stays
  // partner_deals
  s['partner_deals/deal1'] = { partnerUid: 'p1', client: 'Acme Vulcanizing Ltd', contractValue: 987654.32, cost: 55555 };
  s['partner_deals/deal2'] = { client: 'Other Client Inc', contractValue: 777777 };         // no partnerUid: still goes
  // sops
  s['sops/sop_seed'] = { title: '\u{1F91D} Partner Deal Process (50/50)', items: ['Gross Profit = Contract Value - Cost.'], order: 9 };
  s['sops/sop_edit'] = { title: 'Partner deals - how we split', items: ['x'], order: 10 };
  s['sops/sop_dealer'] = { title: 'Partner Dealer Onboarding', items: ['x'], order: 11 };    // unrelated: stays
  s['sops/sop_daily'] = { title: '\u{1F4C5} Daily Attendance', items: ['x'], order: 0 };
  s['sops/sop_notitle'] = { items: ['x'], order: 12 };
  // approval_requests
  s['approval_requests/ap1'] = { type: 'bs_quote', agentId: 'p1', quoteId: 'q_p1', clientName: 'Acme Vulcanizing Ltd', total: 987654.32, status: 'pending' };
  s['approval_requests/ap2'] = { type: 'bs_quote', agentId: 'ghostA', quoteId: 'q_pt', status: 'pending' };     // by the quote it points to
  s['approval_requests/ap3'] = { type: 'bs_quote', agentId: 'emp1', quoteId: 's1', status: 'pending' };         // staff: stays
  s['approval_requests/ap4'] = { type: 'ca_deduct', userId: 'emp1', amount: 500, status: 'pending' };
  // posts
  s['posts/po1'] = { authorId: 'p2', dept: 'Sales', title: 'By a partner' };
  s['posts/po2'] = { authorId: 'emp1', dept: 'Partners', title: 'For the Partners department' };
  s['posts/po3'] = { authorId: 'emp1', dept: 'Sales', title: 'Staff post' };
  s['posts/po4'] = { authorId: 'pres', dept: '', title: 'President post' };
  // conversations (+ children)
  s['conversations/c_w'] = { type: 'dm', participants: ['p1', 'p2'], participantNames: { p1: 'Zelda Quartermain', p2: 'Pablo Partnerson' } };
  s['conversations/c_wg'] = { type: 'group', name: 'Quartermain group', participants: ['p1', 'p2', 'p3'] };
  s['conversations/dept_Partners'] = { type: 'dept', department: 'Partners', participants: [] };
  s['conversations/c_m1'] = { type: 'dm', participants: ['emp1', 'p1'] };                                      // direct staff-partner thread: DELETED
  s['conversations/c_m2'] = {                                                                                  // GROUP (3 staff + 1 partner): KEPT, the partner taken out
    type: 'group', name: 'Steel coordination', createdBy: 'emp1', createdByName: 'Eli Employee',
    participants: ['emp1', 'emp2', 'mgr', 'p2'],
    participantNames: { emp1: 'Eli Employee', emp2: 'Ana Agent', mgr: 'Mara Manager', p2: 'Pablo Partnerson' },
    reads: { emp1: TS('2026-05-01T00:00:00.000Z'), mgr: TS('2026-05-02T00:00:00.000Z'), p2: TS('2026-05-03T00:00:00.000Z') },
    pinnedBy: { emp1: true, p2: true }, mutedBy: { p2: true }, archivedBy: { mgr: true, p2: true },
    lastMessageAt: TS('2026-05-03T00:00:00.000Z'), lastMessageText: 'SECRET-MESSAGE-BODY-xyz', lastMessageBy: 'p2', lastMessageByName: 'Pablo Partnerson',
    pinnedMsgIds: ['m1', 'm2'],
  };
  s['conversations/c_m3'] = { type: 'announcement', participants: ['pres', 'p3'] };                             // 1 staff + 1 partner: direct-like, DELETED
  s['conversations/c_m4'] = {                                                                                  // GROUP (2 staff + 2 partners): KEPT, both partners taken out
    type: 'group', name: 'Two partners in a staff group', participants: ['emp1', 'mgr', 'p1', 'p3'],
    participantNames: { emp1: 'Eli Employee', mgr: 'Mara Manager', p1: 'Zelda Quartermain', p3: 'Tessa Titlemark' },
    lastMessageAt: TS('2026-05-04T00:00:00.000Z'), lastMessageText: 'a staff member had the last word', lastMessageBy: 'emp1', lastMessageByName: 'Eli Employee',
    pinnedMsgIds: [],
  };
  s['conversations/c_m5'] = { type: 'group', participants: ['emp2', 'p2'] };                                   // a two-person "group": 1 staff -> DELETED
  s['conversations/c_m6'] = { type: 'group', participants: ['emp1', 'p1', 'p2'] };                             // 1 staff + 2 partners -> DELETED
  s['conversations/c_s'] = { type: 'dm', participants: ['emp1', 'emp2'] };                                     // staff only: stays
  s['conversations/dept_Sales'] = { type: 'dept', department: 'Sales', participants: [] };                      // other department channel: stays
  s['conversations/dept_Finance'] = { type: 'dept', department: 'Finance', participants: ['p1'] };              // (the rules forbid this) still never touched
  s['conversations/c_np'] = { type: 'group', name: 'No participants field' };
  const msg = (authorId) => ({ authorId, text: 'SECRET-MESSAGE-BODY-xyz', createdAt: TS('2026-04-05T06:07:08.000Z') });
  s['conversations/c_w/messages/m1'] = msg('p1');
  s['conversations/c_w/messages/m2'] = msg('p2');
  s['conversations/c_w/readers/p1'] = { at: TS('2026-04-05T06:07:08.000Z') };
  s['conversations/c_w/typing/p2'] = { at: TS('2026-04-05T06:07:09.000Z') };
  s['conversations/c_wg/messages/m1'] = msg('p3');
  s['conversations/dept_Partners/messages/m1'] = msg('emp1');
  s['conversations/c_m1/messages/m1'] = msg('emp1');
  s['conversations/c_m1/messages/m2'] = msg('p1');
  s['conversations/c_m2/messages/m1'] = msg('mgr');                                                            // staff: stays
  s['conversations/c_m2/messages/m2'] = msg('p2');                                                             // the partner's own message: deleted (its pin is left as it is)
  s['conversations/c_m2/messages/m3'] = Object.assign(msg('emp1'), { reactions: { p2: 'thumbs' } });           // staff message with a partner reaction: untouched
  s['conversations/c_m2/readers/emp1'] = { at: TS('2026-05-01T00:00:00.000Z') };                               // stays
  s['conversations/c_m2/readers/p2'] = { at: TS('2026-05-03T00:00:00.000Z') };                                 // the partner's read mark: deleted
  s['conversations/c_m2/typing/p2'] = { at: TS('2026-05-03T00:00:01.000Z') };                                  // deleted
  s['conversations/c_m3/messages/m1'] = msg('pres');
  s['conversations/c_m4/messages/m1'] = msg('p1');                                                             // deleted
  s['conversations/c_m4/messages/m2'] = msg('p3');                                                             // deleted
  s['conversations/c_m4/messages/m3'] = msg('emp1');                                                           // stays
  s['conversations/c_m4/readers/p1'] = { at: TS('2026-05-04T00:00:00.000Z') };                                 // deleted
  s['conversations/c_m4/readers/mgr'] = { at: TS('2026-05-04T00:00:00.000Z') };                                // stays
  s['conversations/c_m5/messages/m1'] = msg('emp2');
  s['conversations/c_m6/messages/m1'] = msg('p1');
  s['conversations/c_s/messages/m1'] = msg('emp1');                                                            // stays
  s['conversations/dept_Sales/messages/m1'] = msg('emp2');                                                     // stays
  // job_projects: reported only
  s['job_projects/jp1'] = { partnerUid: 'p1', createdBy: 'p1', split: { isShared: true, barroPct: 50, partnerPct: 50 } };
  s['job_projects/jp2'] = { createdBy: 'p2' };
  s['job_projects/jp3'] = { createdBy: 'emp1', partnerUid: null };
  // usernames
  s['usernames/zelda'] = { email: 'zelda.q@partnerco.example', uid: 'p1' };
  s['usernames/pablo_legacy'] = { email: 'PABLO@partnerco.example' };                                         // legacy doc, no uid: matched by email
  s['usernames/px_name'] = { email: 'px@ghost.example', uid: 'px' };                                           // the Auth-only partner
  s['usernames/eli'] = { email: 'eli@barro.example', uid: 'emp1' };                                            // stays
  // notifications (items + one parent doc)
  s['notifications/p1/items/n1'] = { title: 'Quote returned', body: 'SECRET-MESSAGE-BODY-xyz', read: false };
  s['notifications/p1/items/n2'] = { title: 'Another', read: true };
  s['notifications/p2'] = { note: 'parent doc' };
  s['notifications/p2/items/n3'] = { title: 'Third', read: false };
  s['notifications/emp1/items/n4'] = { title: 'Staff notification' };                                         // stays
  // other per-uid docs
  s['payroll/p1'] = { salary: 777777 };
  s['payroll/emp1'] = { salary: 424242 };                                                                      // stays
  s['kpi_evals/p2'] = { selfGrade: 5 };
  s['kpi_targets/p1'] = { target: 1 };
  s['leave_balances/p2'] = { vacation: 5, sick: 5 };
  s['attendance/p1'] = { uid: 'p1' };
  s['attendance/p1/records/2026-01-01'] = { loginTime: '08:00' };
  s['attendance/emp1/records/2026-01-01'] = { loginTime: '08:01' };                                            // stays
  s['personal_todos/p1'] = { owner: 'p1' };
  s['personal_todos/p1/items/t1'] = { text: 'x' };
  s['personal_todos/pres/items/t9'] = { text: 'president to-do' };                                             // stays
  return s;
}

const authUser = (uid, email, claims, extra) => Object.assign({
  uid, email, displayName: 'Name of ' + uid, phoneNumber: null, disabled: false, emailVerified: true, customClaims: claims || null,
  providerData: [{ providerId: 'password' }], metadata: { creationTime: 'Mon, 05 Jan 2026 00:00:00 GMT', lastSignInTime: 'Tue, 06 Jan 2026 00:00:00 GMT' },
  passwordHash: 'HASH-abc123', passwordSalt: 'SALT-xyz789',
}, extra || {});
function worldAuth() {
  return [
    authUser('pres', 'penny@barro.example', { role: 'president' }),
    authUser('mgr', 'mara@barro.example', { role: 'manager' }),
    authUser('emp1', 'eli@barro.example', { role: 'employee' }),
    authUser('emp2', 'ana@barro.example', { role: 'agent' }),
    authUser('p1', 'zelda.q@partnerco.example', { role: 'partner', departments: ['Brilliant Steel'] }),
    authUser('p2', 'pablo@partnerco.example', { role: 'Partner' }),
    authUser('adm', 'marco@barro.example', { role: 'manager' }),
    authUser('bsx', 'bea@barro.example', { role: 'employee' }),
    authUser('bsy', 'ben@barro.example', { role: 'employee' }),
    authUser('px', 'px@ghost.example', { role: 'partner' }),                 // claim says partner, no users doc at all
  ];                                                                           // (p3 has no Auth account at all)
}

// What the purge must delete from that world, written out here independently of the script.
const EXPECTED_DELETES = sorted([
  'approval_requests/ap1', 'approval_requests/ap2',
  'attendance/p1', 'attendance/p1/records/2026-01-01',
  'bs_quotes/draft_p1', 'bs_quotes/draft_p3', 'bs_quotes/q_p1', 'bs_quotes/q_p2', 'bs_quotes/q_pt', 'bs_quotes/q_role', 'bs_quotes/qd_by',
  'conversations/c_m1', 'conversations/c_m1/messages/m1', 'conversations/c_m1/messages/m2',
  'conversations/c_m2/messages/m2', 'conversations/c_m2/readers/p2', 'conversations/c_m2/typing/p2',          // the kept group chat c_m2: only the partner's own
  'conversations/c_m3', 'conversations/c_m3/messages/m1',
  'conversations/c_m4/messages/m1', 'conversations/c_m4/messages/m2', 'conversations/c_m4/readers/p1',        // the kept group chat c_m4: only the partners' own
  'conversations/c_m5', 'conversations/c_m5/messages/m1',
  'conversations/c_m6', 'conversations/c_m6/messages/m1',
  'conversations/c_w', 'conversations/c_w/messages/m1', 'conversations/c_w/messages/m2', 'conversations/c_w/readers/p1', 'conversations/c_w/typing/p2',
  'conversations/c_wg', 'conversations/c_wg/messages/m1',
  'conversations/dept_Partners', 'conversations/dept_Partners/messages/m1',
  'kpi_evals/p2', 'kpi_targets/p1', 'leave_balances/p2',
  'notifications/p1/items/n1', 'notifications/p1/items/n2', 'notifications/p2', 'notifications/p2/items/n3',
  'partner_deals/deal1', 'partner_deals/deal2',
  'payroll/p1',
  'personal_todos/p1', 'personal_todos/p1/items/t1',
  'posts/po1', 'posts/po2',
  'sops/sop_edit', 'sops/sop_seed',
  'usernames/pablo_legacy', 'usernames/px_name', 'usernames/zelda',
  'users/p1', 'users/p2', 'users/p3',
]);
const EXPECTED_AUTH_DELETES = ['p1', 'p2', 'px'];                      // p3 has no Auth account (tolerated)
// The two group chats that are KEPT and edited, and what each must look like afterwards (written out here, independently of the script).
const EXPECTED_GROUP_EDITS = sorted(['conversations/c_m2', 'conversations/c_m4']);
const expectedGroupAfter = () => ({
  'conversations/c_m2': {
    type: 'group', name: 'Steel coordination', createdBy: 'emp1', createdByName: 'Eli Employee',
    participants: ['emp1', 'emp2', 'mgr'],
    participantNames: { emp1: 'Eli Employee', emp2: 'Ana Agent', mgr: 'Mara Manager' },
    reads: { emp1: TS('2026-05-01T00:00:00.000Z'), mgr: TS('2026-05-02T00:00:00.000Z') },
    pinnedBy: { emp1: true }, mutedBy: {}, archivedBy: { mgr: true },
    lastMessageAt: TS('2026-05-03T00:00:00.000Z'), lastMessageText: null, lastMessageBy: 'p2', lastMessageByName: null,
    pinnedMsgIds: ['m1', 'm2'],                                                      // a pin of a deleted message is left as it is
  },
  'conversations/c_m4': {
    type: 'group', name: 'Two partners in a staff group', participants: ['emp1', 'mgr'],
    participantNames: { emp1: 'Eli Employee', mgr: 'Mara Manager' },
    lastMessageAt: TS('2026-05-04T00:00:00.000Z'), lastMessageText: 'a staff member had the last word', lastMessageBy: 'emp1', lastMessageByName: 'Eli Employee',
    pinnedMsgIds: [],
  },
});

// ── the input select() takes, built from a seed: EVERY uid's per-uid docs go in, partner or not, so the filtering is the script's job ──
const ROOTS = ['users', 'bs_quotes', 'partner_deals', 'approval_requests', 'posts', 'conversations', 'job_projects', 'usernames', 'sops'];
const PER_UID_ROOTS = ['payroll', 'kpi_evals', 'kpi_targets', 'leave_balances', 'attendance', 'personal_todos', 'notifications'];
function inputFromSeed(seed, authList) {
  const segs = (p) => p.split('/');
  const input = {};
  ROOTS.forEach((c) => { input[c] = Object.keys(seed).filter((p) => segs(p)[0] === c && segs(p).length === 2).sort().map((p) => rec(segs(p)[1], cloneData(seed[p]))); });
  input.authUsers = (authList || []).map(toAuthRecord);
  input.groupChildren = { 'conversations/messages': [], 'conversations/readers': [], 'conversations/typing': [] };
  input.perUid = {};
  input.notificationsByUid = {};
  for (const p of Object.keys(seed).sort()) {
    const s = segs(p);
    if (s[0] === 'conversations' && s.length === 4 && ['messages', 'readers', 'typing'].indexOf(s[2]) >= 0) {
      input.groupChildren['conversations/' + s[2]].push(rec(s[1] + '/' + s[3], cloneData(seed[p])));          // EVERY conversation's children, not only the groups'
      continue;
    }
    if (PER_UID_ROOTS.indexOf(s[0]) < 0) continue;
    if (s.length === 2) (input.perUid[s[0]] = input.perUid[s[0]] || []).push(rec(s[1], cloneData(seed[p])));
    else if (s.length === 4 && s[0] === 'notifications' && s[2] === 'items') (input.notificationsByUid[s[1]] = input.notificationsByUid[s[1]] || []).push(rec(s[3], cloneData(seed[p])));
    else if (s.length === 4) (input.perUid[s[0] + '/' + s[2]] = input.perUid[s[0] + '/' + s[2]] || []).push(rec(s[1] + '/' + s[3], cloneData(seed[p])));
  }
  return input;
}

// ── in-memory fakes ─────────────────────────────────────────────────────────
// Firestore: collection().get()/where('field','in',[..]).get(), doc().get()/collection()/listCollections(), batch().delete()/update()/commit(). There is
// deliberately NO set/add: a script that tried to write that way would throw. batch.update understands the two FieldValue sentinels the script uses
// (arrayRemove, delete) and dotted field paths, and fails on a missing doc like the real thing. A commit lands a macrotask late (an un-awaited commit
// would be caught), refuses more than 500 operations, and can be made to fail (failCommitAt), to silently not delete (ghost) or not update (ghostUpdate).
const FV = { arrayRemove: (...values) => ({ __fv: 'arrayRemove', values }), delete: () => ({ __fv: 'delete' }) };
function applyPatch(data, patch) {
  const out = cloneData(data);
  for (const key of Object.keys(patch)) {
    const val = patch[key];
    const path = key.split('.');
    let target = out;
    for (let i = 0; i < path.length - 1; i++) {
      if (!target[path[i]] || typeof target[path[i]] !== 'object') target[path[i]] = {};
      target = target[path[i]];
    }
    const leaf = path[path.length - 1];
    if (val && val.__fv === 'delete') delete target[leaf];
    else if (val && val.__fv === 'arrayRemove') target[leaf] = (Array.isArray(target[leaf]) ? target[leaf] : []).filter((x) => val.values.indexOf(x) < 0);
    else target[leaf] = val;
  }
  return out;
}
function fakeFirestore(seed, o) {
  const opts = o || {};
  const store = new Map(Object.keys(seed).map((p) => [p, cloneData(seed[p])]));
  const events = opts.events || [];
  const api = { store, reads: [], requested: [], deleted: [], updates: [], batchSizes: [], commits: 0, failCommitAt: opts.failCommitAt || 0, ghost: opts.ghost || new Set(), ghostUpdate: opts.ghostUpdate || new Set() };
  const segs = (p) => p.split('/');
  const last = (p) => segs(p)[segs(p).length - 1];
  const docRef = (p) => ({
    id: last(p), path: p,
    collection: (name) => colRef(p + '/' + name),
    async get() { api.reads.push(p); const has = store.has(p); return { exists: has, id: last(p), data: () => (has ? cloneData(store.get(p)) : undefined) }; },
    async listCollections() {
      const names = new Set();
      for (const k of store.keys()) if (k.indexOf(p + '/') === 0) names.add(segs(k.slice(p.length + 1))[0]);
      return Array.from(names).sort().map((n) => colRef(p + '/' + n));
    },
  });
  const colRef = (p) => ({
    id: last(p), path: p,
    doc: (id) => docRef(p + '/' + id),
    where(field, op, value) {
      if (op !== 'in' || !Array.isArray(value) || !value.length || value.length > 10) throw new Error('the fake supports only where(field, "in", 1..10 values)');
      return {
        async get() {
          api.reads.push(p + '?' + field);
          const keys = Array.from(store.keys()).filter((k) => k.indexOf(p + '/') === 0 && segs(k).length === segs(p).length + 1 && value.indexOf((store.get(k) || {})[field]) >= 0).sort();
          return { size: keys.length, empty: !keys.length, docs: keys.map((k) => ({ id: last(k), ref: docRef(k), data: () => cloneData(store.get(k)) })) };
        },
      };
    },
    async get() {
      api.reads.push(p);
      const keys = Array.from(store.keys()).filter((k) => k.indexOf(p + '/') === 0 && segs(k).length === segs(p).length + 1).sort();
      return { size: keys.length, empty: !keys.length, docs: keys.map((k) => ({ id: last(k), ref: docRef(k), data: () => cloneData(store.get(k)) })) };
    },
  });
  api.collection = colRef;
  api.doc = docRef;
  api.batch = () => {
    const ops = [];
    const room = () => { if (ops.length >= 500) throw new Error('a Firestore batch holds at most 500 operations'); };
    return {
      delete(ref) { room(); ops.push({ t: 'delete', path: ref.path }); },
      update(ref, patch) { room(); ops.push({ t: 'update', path: ref.path, patch }); },
      async commit() {
        api.commits++;
        if (api.failCommitAt && api.commits === api.failCommitAt) throw new Error('commit failed (injected)');
        if (api.failOnUpdate && ops.some((op) => op.t === 'update')) throw new Error('update batch failed (injected)');
        await new Promise((resolve) => setImmediate(resolve));
        api.batchSizes.push(ops.length);
        for (const op of ops) {
          if (op.t === 'update') {
            if (!store.has(op.path)) throw new Error('NOT_FOUND: no document to update: ' + op.path);
            api.updates.push({ path: op.path, patch: op.patch });
            events.push({ t: 'fs-update', path: op.path });
            if (!api.ghostUpdate.has(op.path)) store.set(op.path, applyPatch(store.get(op.path), op.patch));
            continue;
          }
          const p = op.path;
          api.requested.push(p);
          events.push({ t: 'fs-delete', path: p });
          if (api.ghost.has(p)) continue;                                  // a delete that silently does nothing
          store.delete(p);
          api.deleted.push(p);
        }
      },
    };
  };
  return api;
}

// Auth: listUsers (paged), deleteUser (auth/user-not-found when the account is gone).
function fakeAuth(list, o) {
  const opts = o || {};
  const store = new Map(list.map((u) => [u.uid, cloneData(u)]));
  const events = opts.events || [];
  const api = { store, requested: [], deleted: [], listCalls: 0, ghost: opts.ghost || new Set(), failDeleteFor: opts.failDeleteFor || new Set() };
  api.listUsers = async (max, token) => {
    api.listCalls++;
    const all = Array.from(store.values());
    const start = token ? Number(token) : 0;
    const size = opts.pageSize || 3;
    return { users: all.slice(start, start + size).map(cloneData), pageToken: start + size < all.length ? String(start + size) : undefined };
  };
  api.deleteUser = async (uid) => {
    if (api.failDeleteFor.has(uid)) { const e = new Error('internal error'); e.code = 'auth/internal-error'; throw e; }
    if (!store.has(uid)) { const e = new Error('There is no user record corresponding to the provided identifier.'); e.code = 'auth/user-not-found'; throw e; }
    api.requested.push(uid);
    events.push({ t: 'auth-delete', uid });
    if (api.ghost.has(uid)) return;
    store.delete(uid);
    api.deleted.push(uid);
  };
  return api;
}

// File system: exists / mkdirp / write / read / syncDir. `corrupt(path, text)` can return different text for a file (a short write).
function memIo(o) {
  const opts = o || {};
  const files = new Map();
  const dirs = new Set();
  const writes = [];
  return {
    files, dirs, writes,
    exists: (p) => files.has(p) || dirs.has(p),
    mkdirp: (p) => { dirs.add(p); },
    write: (p, text) => { writes.push(p); files.set(p, opts.corrupt ? opts.corrupt(p, text) : text); },
    read: (p) => { if (!files.has(p)) throw new Error('ENOENT: ' + p); return files.get(p); },
    syncDir: () => {},
  };
}

function makeEnv(o) {
  const opts = o || {};
  const events = [];
  const seed = opts.seed || worldSeed();
  const db = fakeFirestore(seed, { events, ghost: opts.ghost, ghostUpdate: opts.ghostUpdate, failCommitAt: opts.failCommitAt });
  const auth = fakeAuth(opts.auth || worldAuth(), { events, pageSize: opts.pageSize, ghost: opts.authGhost, failDeleteFor: opts.failDeleteFor });
  const io = opts.io || memIo();
  const out = { lines: [], log: (l) => out.lines.push(String(l)) };
  return { seed, db, auth, io, events, out, deps: { db, auth, io, FieldValue: opts.noFieldValue ? undefined : FV, now: () => new Date('2026-10-30T12:00:00.000Z') } };
}
const text = (env) => env.out.lines.join('\n');
const noLeak = (str, what) => { for (const p of PII) assert.ok(str.indexOf(p) < 0, what + ': "' + p + '" leaked'); };
const BK = '/bk/one';
const mf = (dir) => path.join(dir, 'manifest.json');

// ═════════════════════════════════════════════════════════════════════════════
describe('select — who is a partner', () => {
  const users = (list) => list.map(([id, data]) => rec(id, data));

  it('takes role, team, title or the Partners department — trimmed, any case, either department field', () => {
    const sel = select({ users: users([
      ['a', { role: 'partner' }],
      ['b', { role: ' PARTNER ' }],
      ['c', { role: 'employee', team: 'Partner' }],
      ['d', { role: 'employee', title: ' partner' }],
      ['e', { role: 'employee', departments: ['Partners'] }],
      ['f', { role: 'agent', department: 'partners' }],                       // the legacy department string
      ['i', { role: 'agent', departments: ['Sales'], department: 'Partners' }], // the two fields disagree: either one counts
      ['g', { role: 'employee', departments: ['Sales'] }],
      ['h', { role: 'employee', title: 'Business Partner' }],                  // exact title only
      ['j', { role: 'employee', departments: ['Partners Relations'] }],
      ['k', {}],
    ]) });
    assert.deepEqual(sel.partnerUids, ['a', 'b', 'c', 'd', 'e', 'f', 'i']);
    assert.deepEqual(ids(sel.users), ['a', 'b', 'c', 'd', 'e', 'f', 'i']);
    assert.deepEqual(sel.userEvidence.a, { role: true, team: false, title: false, dept: false });
    assert.deepEqual(sel.userEvidence.c, { role: false, team: true, title: false, dept: false });
    assert.deepEqual(sel.userEvidence.d, { role: false, team: false, title: true, dept: false });
    assert.deepEqual(sel.userEvidence.e, { role: false, team: false, title: false, dept: true });
    assert.deepEqual(sel.needsLook.users, []);
  });

  it('never takes an admin role on a team / title / department marker alone: it is listed as "needs a look" and kept', () => {
    for (const role of ['president', 'owner', 'admin', 'manager', 'secretary', 'finance', ' Manager ', 'PRESIDENT']) {
      for (const marker of [{ title: 'Partner' }, { team: 'partner' }, { departments: ['Partners'] }, { department: 'Partners' }]) {
        const sel = select({ users: users([['u', Object.assign({ role }, marker)]]) });
        assert.deepEqual(sel.partnerUids, [], role + ' ' + JSON.stringify(marker));
        assert.deepEqual(sel.users, []);
        assert.deepEqual(sel.needsLook.users, ['u'], role + ' ' + JSON.stringify(marker));
      }
    }
    // role 'partner' itself is always a partner; an employee with the same markers is a partner too
    assert.deepEqual(select({ users: users([['u', { role: 'partner', title: 'President' }]]) }).partnerUids, ['u']);
    assert.deepEqual(select({ users: users([['u', { role: 'employee', title: 'Partner' }]]) }).partnerUids, ['u']);
  });

  it('an Auth account whose claim says partner and that has NO users doc is a partner account; one whose profile says otherwise is only "needs a look"', () => {
    const sel = select({
      users: users([['staff', { role: 'employee' }], ['pp', { role: 'partner' }]]),
      authUsers: [
        { uid: 'orphan', email: 'o@x.example', customClaims: { role: 'Partner' } },
        { uid: 'staff', customClaims: { role: 'partner' } },                    // stale claim on a staff account
        { uid: 'pp', customClaims: { role: 'partner' } },
        { uid: 'fine', customClaims: { role: 'employee' } },
        { uid: 'noclaims', customClaims: null },
        null,
      ],
    });
    assert.deepEqual(sel.partnerUids, ['orphan', 'pp']);
    assert.deepEqual(sel.authOnlyUids, ['orphan']);
    assert.deepEqual(sel.needsLook.auth, ['staff']);
    assert.deepEqual(ids(sel.users), ['pp']);                                     // only real profiles are users docs to delete
  });

  it('knownPartnerUids are treated as partners even though their users docs are gone (the post-apply verification relies on it)', () => {
    const sel = select({
      users: users([['staff', { role: 'employee' }]]),
      posts: [rec('p1', { authorId: 'gone1' }), rec('p2', { authorId: 'staff' })],
      knownPartnerUids: ['gone1', 7, '', null],
    });
    assert.deepEqual(sel.partnerUids, ['gone1']);
    assert.deepEqual(ids(sel.posts), ['p1']);
  });

  it('Brilliant-Steel-only accounts whose role is not partner are COUNTED (owner Q3) and never selected', () => {
    const sel = select({ users: users([
      ['bs1', { role: 'employee', departments: ['Brilliant Steel'] }],
      ['bs2', { role: 'agent', department: 'brilliant steel' }],                  // legacy string, any case
      ['bs3', { role: 'manager', departments: ['Brilliant Steel', 'Brilliant Steel'] }],
      ['mix', { role: 'employee', departments: ['Brilliant Steel', 'Sales'] }],    // two departments: not BS-only
      ['none', { role: 'employee', departments: [] }],
      ['sales', { role: 'employee', departments: ['Sales'] }],
      ['pbs', { role: 'partner', departments: ['Brilliant Steel'] }],              // a partner: deleted, so not in this list
      ['tbs', { role: 'employee', team: 'partner', departments: ['Brilliant Steel'] }],   // a partner by team marker: deleted, so not in this list
    ]) });
    assert.deepEqual(sel.bsOnlyNonPartner, ['bs1', 'bs2', 'bs3']);
    assert.deepEqual(sel.partnerUids, ['pbs', 'tbs']);
    assert.ok(!sel.users.some((r) => sel.bsOnlyNonPartner.indexOf(r.id) >= 0));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('select — bs_quotes: the staff-vs-partner split', () => {
  const base = { users: [rec('p', { role: 'partner' }), rec('emp', { role: 'employee' }), rec('boss', { role: 'president' })] };
  const pick = (quotes, extra) => select(Object.assign({}, base, extra || {}, { bs_quotes: quotes.map(([id, d]) => rec(id, d)) }));

  it('takes a quote by createdByRole alone (creator unknown), by createdBy, by draftBy, by the draft_<uid> id, and by company PT', () => {
    const sel = pick([
      ['byRole', { createdByRole: 'partner', createdBy: 'nobody-we-know' }],
      ['byRoleCase', { createdByRole: ' Partner ' }],
      ['byCreator', { createdBy: 'p', createdByRole: 'employee' }],
      ['byDraftBy', { draftBy: 'p' }],
      ['draft_p', {}],
      ['byPT', { company: 'PT' }],
      ['byPTcase', { company: 'pt ' }],
    ]);
    assert.deepEqual(ids(sel.bsQuotes), ['byCreator', 'byDraftBy', 'byPT', 'byPTcase', 'byRole', 'byRoleCase', 'draft_p']);
    assert.equal(sel.bsQuotesKept, 0);
    assert.equal(sel.bsQuotesViaRoleOnly, 2);                                       // byRole + byRoleCase; the rest have a uid or PT behind them
  });

  it('keeps every staff-made quote, including a staff draft slot and the president\'s', () => {
    const sel = pick([
      ['s1', { createdBy: 'emp', createdByRole: 'employee', company: 'BS' }],
      ['s2', { createdBy: 'boss', createdByRole: 'president', company: 'BS' }],
      ['draft_emp', { draftBy: 'emp' }],
      ['draft_boss', {}],
      ['s3', { createdBy: 'emp', company: 'BK' }],
      ['s4', {}],
    ]);
    assert.deepEqual(sel.bsQuotes, []);
    assert.equal(sel.bsQuotesKept, 6);
    assert.deepEqual(sel.needsLook.bsQuotes, []);
  });

  it('a quote tagged partner but made by a KNOWN staff account is "needs a look" and is kept (the old createdByRole fallback)', () => {
    const sel = pick([
      ['mis', { createdByRole: 'partner', createdBy: 'emp' }],
      ['misBoss', { createdByRole: 'partner', createdBy: 'boss' }],
      ['real', { createdByRole: 'partner', createdBy: 'p' }],                      // the creator IS a partner: goes
      ['unknown', { createdByRole: 'partner', createdBy: 'ghost' }],                // the creator is not a known account: goes
      ['noCreator', { createdByRole: 'partner' }],
    ]);
    assert.deepEqual(ids(sel.bsQuotes), ['noCreator', 'real', 'unknown']);
    assert.deepEqual(sel.needsLook.bsQuotes.slice().sort(), ['mis', 'misBoss']);
    // company PT outranks the staff creator: PT quotes only ever came out of the partner portal
    assert.deepEqual(ids(pick([['pt', { company: 'PT', createdBy: 'emp', createdByRole: 'employee' }]]).bsQuotes), ['pt']);
  });

  it('draft_<uid> only counts for a partner uid, and a staff uid inside a normal id does not match', () => {
    // 't_p' is a partner uid on purpose: an id that merely CONTAINS 'draft_' further in ('xxdraft_p') must not be read as a draft slot of 't_p'
    const extra = { users: base.users.concat(rec('t_p', { role: 'partner' })) };
    const sel = pick([['draft_p', {}], ['draft_emp', {}], ['xdraft_p', {}], ['xxdraft_p', {}], ['draft_', {}], ['draft_p2', {}], ['draft_t_p', {}]], extra);
    assert.deepEqual(ids(sel.bsQuotes), ['draft_p', 'draft_t_p']);
  });

  it('approval requests go by agentId or by a deleted quote; every other approval stays', () => {
    const sel = select(Object.assign({}, base, {
      bs_quotes: [rec('q1', { createdBy: 'p' }), rec('q2', { createdBy: 'emp' }), rec('q3', { company: 'PT' })],
      approval_requests: [
        rec('a1', { agentId: 'p', quoteId: 'q2' }),            // agent is a partner
        rec('a2', { agentId: 'emp', quoteId: 'q1' }),          // points at a deleted quote
        rec('a3', { agentId: 'emp', quoteId: 'q2' }),          // staff, staff quote
        rec('a4', { type: 'ca_deduct', userId: 'emp' }),
        rec('a5', { agentId: 'zz', quoteId: 'q3' }),           // the PT quote
        rec('a6', {}),
      ],
    }));
    assert.deepEqual(ids(sel.approvalRequests), ['a1', 'a2', 'a5']);
  });

  it('every partner_deals doc goes, with or without a partnerUid', () => {
    const sel = select({ partner_deals: [rec('d1', { partnerUid: 'x' }), rec('d2', {}), rec('d3', { partnerUid: null })] });
    assert.deepEqual(ids(sel.partnerDeals), ['d1', 'd2', 'd3']);
  });

  it('posts go by the Partners department or a partner author; the seeded "Partner Deal Process" SOP goes by title and nothing like it does', () => {
    const sel = select(Object.assign({}, base, {
      posts: [rec('a', { authorId: 'p', dept: 'Sales' }), rec('b', { authorId: 'emp', dept: ' PARTNERS ' }), rec('c', { authorId: 'emp', dept: 'Sales' }), rec('d', {})],
      sops: [
        rec('s1', { title: '\u{1F91D} Partner Deal Process (50/50)' }),
        rec('s2', { title: 'Partner Deal Process (50/50)' }),
        rec('s3', { title: 'PARTNER DEALS' }),
        rec('s4', { title: 'partner-deal flow' }),
        rec('s5', { title: 'Partner Dealer Onboarding' }),
        rec('s6', { title: 'Partner Dealership SOP' }),
        rec('s7', { title: 'Business partner dealings' }),
        rec('s8', { title: '\u{1F4C5} Daily Attendance' }),
        rec('s9', { items: ['partner deal'] }),
        rec('s10', { title: null }),
        rec('s11', { title: 42 }),
      ],
    }));
    assert.deepEqual(ids(sel.posts), ['a', 'b']);
    assert.deepEqual(ids(sel.partnerSops), ['s1', 's2', 's3', 's4']);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('select — conversations (owner Q4; mixed GROUP chats are kept — coordinator 2026-10-28)', () => {
  const sel = (convs, extra) => select(Object.assign({
    users: [rec('p1', { role: 'partner' }), rec('p2', { role: 'partner' }), rec('s1', { role: 'employee' }), rec('s2', { role: 'employee' }), rec('s3', { role: 'employee' })],
    conversations: convs.map(([id, d]) => rec(id, d)),
  }, extra || {}));

  it('by who is left once the partners are taken out: nobody -> deleted; ONE staff member -> a direct thread, deleted; TWO or more -> a group chat, KEPT', () => {
    const r = sel([
      ['dmWhole', { type: 'dm', participants: ['p1', 'p2'] }],
      ['grpWhole', { type: 'group', participants: ['p1'] }],
      ['dmMixed', { type: 'dm', participants: ['s1', 'p1'] }],
      ['annDirect', { type: 'announcement', participants: ['s1', 'p1'] }],
      ['grpOneStaff', { type: 'group', participants: ['s1', 'p1', 'p2'] }],         // one staff member + two partners: still a staff-partner thread
      ['grpTwoPeople', { type: 'group', participants: ['s2', 'p2'] }],              // a two-person "group"
      ['grpMixed', { type: 'group', participants: ['s1', 's2', 'p2'] }],
      ['annMixed', { type: 'announcement', participants: ['s1', 's2', 's3', 'p1', 'p2'] }],
      ['dmOdd', { type: 'dm', participants: ['s1', 's2', 'p1'] }],                  // not a real DM: two staff members -> the gentler group handling
      ['dupes', { type: 'group', participants: ['s1', 's1', 'p1'] }],               // the same member twice is still ONE staff member
      ['staffDm', { type: 'dm', participants: ['s1', 's2'] }],
      ['staffGroup', { type: 'group', participants: ['s1', 's2', 's3'] }],
      ['strangers', { type: 'dm', participants: ['x', 'y'] }],
      ['noParts', { type: 'group' }],
      ['badParts', { type: 'group', participants: 'p1' }],
      ['untyped', { participants: ['s1', 'p1'] }],
      ['untypedGroup', { participants: ['s1', 's2', 'p1'] }],
    ]);
    assert.deepEqual(ids(r.conversationsWhollyPartner), ['dmWhole', 'grpWhole']);
    assert.deepEqual(ids(r.conversationsMixed), ['annDirect', 'dmMixed', 'dupes', 'grpOneStaff', 'grpTwoPeople', 'untyped']);
    assert.deepEqual(ids(r.conversationsGroups), ['annMixed', 'dmOdd', 'grpMixed', 'untypedGroup']);
    assert.equal(r.mixedDirectMessages, 1);                                          // only dmMixed is a type-dm direct thread
    assert.deepEqual(r.mixedStaffAffected, ['s1', 's2']);                            // staff members who LOSE a conversation: the direct threads only
    const everythingDeleted = bucketsOf(r, {}).find((b) => b.key === 'conversations').records;
    assert.deepEqual(ids(everythingDeleted), ['annDirect', 'dmMixed', 'dmWhole', 'dupes', 'grpOneStaff', 'grpTwoPeople', 'grpWhole', 'untyped']);
    assert.ok(!everythingDeleted.some((x) => ['annMixed', 'dmOdd', 'grpMixed', 'untypedGroup'].indexOf(x.id) >= 0), 'a kept group chat is in the delete bucket');
  });

  it('a kept group chat yields its partner\'s messages, read / typing marks and the edit — and only the partner\'s, only in the kept groups', () => {
    const kids = {
      'conversations/messages': [
        rec('grpMixed/m1', { authorId: 'p2' }), rec('grpMixed/m2', { authorId: 's1' }), rec('grpMixed/m3', { authorId: 'p1' }),
        rec('dmMixed/m1', { authorId: 'p1' }),                   // a conversation that is DELETED whole, not a kept group
        rec('staffGroup/m1', { authorId: 'p1' }),                // a conversation without a partner member
      ],
      'conversations/readers': [rec('grpMixed/p2', {}), rec('grpMixed/s1', {}), rec('dmMixed/p1', {})],
      'conversations/typing': [rec('grpMixed/p2', {}), rec('grpMixed/s2', {}), rec('staffGroup/p2', {})],
    };
    const r = sel([
      ['grpMixed', { type: 'group', participants: ['s1', 's2', 'p2'], lastMessageBy: 'p2', lastMessageText: 'x' }],
      ['dmMixed', { type: 'dm', participants: ['s1', 'p1'] }],
      ['staffGroup', { type: 'group', participants: ['s1', 's2', 's3'] }],
    ], { groupChildren: kids });
    assert.deepEqual(ids(r.groupMessages), ['grpMixed/m1', 'grpMixed/m3']);
    assert.deepEqual(ids(r.groupReaders), ['grpMixed/p2']);
    assert.deepEqual(ids(r.groupTyping), ['grpMixed/p2']);
    assert.deepEqual(r.groupEdits.map((e) => e.id), ['grpMixed']);
    assert.deepEqual(r.groupEdits[0].partnerUids, ['p2']);
    assert.equal(r.groupEdits[0].clearLast, true);
    // they ride in the same buckets as every other conversation child, so they are backed up and deleted with them
    const b = (k) => bucketsOf(r, {}).find((x) => x.key === k).records;
    assert.deepEqual(ids(b('conversations/messages')), ['grpMixed/m1', 'grpMixed/m3']);
    assert.deepEqual(ids(b('conversations/readers')), ['grpMixed/p2']);
    assert.deepEqual(ids(b('conversations/typing')), ['grpMixed/p2']);
    // and the originals of the edited docs are a BACKUP-only bucket, never a delete bucket
    assert.equal(bucketsOf(r, {}).some((x) => x.key === 'conversations-group-before-edit'), false);
    assert.deepEqual(editedOriginals(r).records.map((x) => x.id), ['grpMixed']);
    assert.equal(editedOriginals(r).manifest.kind, 'edited-originals');
    // no group children handed in: the edit is still planned (member list), nothing else is selected
    const bare = sel([['grpMixed', { type: 'group', participants: ['s1', 's2', 'p2'] }]]);
    assert.deepEqual(bare.groupEdits.map((e) => e.id), ['grpMixed']);
    assert.deepEqual(bare.groupMessages, []);
  });

  it('only the Partners department channel is selected; every other department channel is left alone even if its participants name a partner', () => {
    const r = sel([
      ['dept_Partners', { type: 'dept', department: 'Partners', participants: [] }],
      ['dept_partners2', { type: 'dept', department: ' partners ' }],
      ['dept_Sales', { type: 'dept', department: 'Sales', participants: [] }],
      ['dept_Finance', { type: 'dept', department: 'Finance', participants: ['p1'] }],
      ['dept_Odd', { department: 'Production', participants: ['p1', 's1'] }],          // no type, but a dept_ id: still a department channel
    ]);
    assert.deepEqual(ids(r.conversationsWhollyPartner), ['dept_Partners', 'dept_partners2']);
    assert.deepEqual(r.conversationsMixed, []);
    assert.deepEqual(r.conversationsGroups, []);
  });

  it('job_projects are reported (tagged / created by a partner) and are in NO delete bucket', () => {
    const r = select({
      users: [rec('p1', { role: 'partner' }), rec('s1', { role: 'employee' })],
      job_projects: [rec('j1', { partnerUid: 'p1', createdBy: 'p1' }), rec('j2', { createdBy: 'p1' }), rec('j3', { partnerUid: 'p1', createdBy: 's1' }), rec('j4', { createdBy: 's1' })],
    });
    assert.deepEqual(ids(r.jobProjectsTagged), ['j1', 'j3']);
    assert.deepEqual(ids(r.jobProjectsCreatedByPartner), ['j1', 'j2']);
    const every = bucketsOf(r, {}).flatMap((b) => b.records.map((x) => b.key + '/' + x.id));
    assert.ok(!every.some((p) => /^job_projects/.test(p) || /\/j[1-4]$/.test(p)), 'a job project is in a delete bucket');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('select — usernames, notifications and the per-uid docs belong to the partners and to nobody else', () => {
  const people = { users: [rec('p', { role: 'partner', email: 'p@x.example' }), rec('s', { role: 'employee', email: 's@x.example' })] };

  it('usernames: by the uid field or by the partner\'s email (any case); a staff username stays', () => {
    const sel = select(Object.assign({}, people, {
      usernames: [rec('n1', { uid: 'p', email: 'whatever' }), rec('n2', { email: 'P@X.example' }), rec('n3', { uid: 's', email: 's@x.example' }), rec('n4', { email: '' }), rec('n5', {}), rec('n6', { uid: 'zzz', email: 'zzz@x.example' })],
      authUsers: [{ uid: 'p', email: 'p@x.example', customClaims: null }],
    }));
    assert.deepEqual(ids(sel.usernames), ['n1', 'n2']);
  });

  it('notification items and per-uid docs: only the partners\' own, even when the loader hands over everybody\'s', () => {
    const sel = select(Object.assign({}, people, {
      notificationsByUid: { p: [rec('a', { t: 1 }), rec('b', {})], s: [rec('c', {})], nobody: [rec('d', {})] },
      perUid: {
        payroll: [rec('p', {}), rec('s', {})],
        'attendance/records': [rec('p/2026-01-01', {}), rec('s/2026-01-01', {})],
        'personal_todos/items': [rec('p/t1', {}), rec('ps/t2', {})],              // 'ps' is not 'p'
        notifications: [rec('p', {}), rec('s', {})],
        'weird/sub': [rec('p/x', {}), rec('s/x', {})],
      },
    }));
    assert.deepEqual(ids(sel.notifications), ['p/a', 'p/b']);
    assert.deepEqual(ids(sel.perUid.payroll), ['p']);
    assert.deepEqual(ids(sel.perUid['attendance/records']), ['p/2026-01-01']);
    assert.deepEqual(ids(sel.perUid['personal_todos/items']), ['p/t1']);
    assert.deepEqual(ids(sel.perUid.notifications), ['p']);
    assert.deepEqual(ids(sel.perUid['weird/sub']), ['p/x']);
    assert.equal(sel.notifications, sel.perUid['notifications/items']);
    PER_UID_KEYS.forEach((k) => assert.ok(Array.isArray(sel.perUid[k]), k + ' is not a bucket'));
  });

  it('the registry covers every per-uid doc the app keeps (a bucket cannot silently drop out)', () => {
    assert.deepEqual(sorted(PER_UID_KEYS), sorted([
      'notifications', 'notifications/items', 'payroll', 'kpi_evals', 'kpi_targets', 'leave_balances',
      'attendance', 'attendance/records', 'personal_todos', 'personal_todos/items',
    ]));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('select — purity and robustness', () => {
  it('never mutates its input (a deep-frozen world goes in), and is deterministic', () => {
    const input = deepFreeze(inputFromSeed(worldSeed(), worldAuth()));
    const before = JSON.stringify(input);
    let a, b;
    assert.doesNotThrow(() => { a = select(input); b = select(input); });
    assert.equal(JSON.stringify(input), before);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
  });

  it('missing, empty and junk inputs select nothing and do not throw', () => {
    for (const inp of [undefined, null, {}, { users: null, bs_quotes: 'x' }, { users: [null, 7, {}, { id: '' }, { id: 5, data: {} }, { id: '', data: { role: 'partner' } }, { id: 5, data: { role: 'partner' } }, { data: { role: 'partner' } }], conversations: [null], authUsers: [undefined, 3] }]) {
      const r = select(inp);
      assert.deepEqual(r.partnerUids, []);
      assert.deepEqual(r.users, []);
      assert.deepEqual(r.bsQuotes, []);
      assert.deepEqual(r.conversationsMixed, []);
      assert.deepEqual(r.conversationsGroups, []);
      assert.deepEqual(r.groupMessages, []);
      assert.deepEqual(r.groupEdits, []);
      assert.deepEqual(r.notifications, []);
    }
  });

  it('a record with no data is handled (a doc with no fields)', () => {
    const r = select({ users: [{ id: 'u' }], bs_quotes: [{ id: 'q' }], posts: [{ id: 'p' }], conversations: [{ id: 'c' }] });
    assert.deepEqual(r.partnerUids, []);
    assert.equal(r.bsQuotesKept, 1);
  });

  it('the full invented world: exactly the expected accounts, documents and report-only sets', () => {
    const sel = select(inputFromSeed(worldSeed(), worldAuth()));
    assert.deepEqual(sel.partnerUids, ['p1', 'p2', 'p3', 'px']);
    assert.deepEqual(ids(sel.users), ['p1', 'p2', 'p3']);
    assert.deepEqual(sel.authOnlyUids, ['px']);
    assert.deepEqual(sel.needsLook, { users: ['adm'], auth: [], bsQuotes: ['s_mis'] });
    assert.deepEqual(sel.bsOnlyNonPartner, ['bsx']);
    assert.deepEqual(ids(sel.bsQuotes), ['draft_p1', 'draft_p3', 'q_p1', 'q_p2', 'q_pt', 'q_role', 'qd_by']);
    assert.equal(sel.bsQuotesKept, 4);
    assert.equal(sel.bsQuotesViaRoleOnly, 1);
    assert.deepEqual(ids(sel.partnerDeals), ['deal1', 'deal2']);
    assert.deepEqual(ids(sel.partnerSops), ['sop_edit', 'sop_seed']);
    assert.deepEqual(ids(sel.approvalRequests), ['ap1', 'ap2']);
    assert.deepEqual(ids(sel.posts), ['po1', 'po2']);
    assert.deepEqual(ids(sel.conversationsWhollyPartner), ['c_w', 'c_wg', 'dept_Partners']);
    assert.deepEqual(ids(sel.conversationsMixed), ['c_m1', 'c_m3', 'c_m5', 'c_m6']);
    assert.deepEqual(ids(sel.conversationsGroups), ['c_m2', 'c_m4']);
    assert.equal(sel.mixedDirectMessages, 1);
    assert.deepEqual(sel.mixedStaffAffected, ['emp1', 'emp2', 'pres']);
    assert.deepEqual(ids(sel.groupMessages), ['c_m2/m2', 'c_m4/m1', 'c_m4/m2']);
    assert.deepEqual(ids(sel.groupReaders), ['c_m2/p2', 'c_m4/p1']);
    assert.deepEqual(ids(sel.groupTyping), ['c_m2/p2']);
    assert.deepEqual(sel.groupEdits.map((e) => e.id), ['c_m2', 'c_m4']);
    assert.deepEqual(ids(sel.jobProjectsTagged), ['jp1']);
    assert.deepEqual(ids(sel.jobProjectsCreatedByPartner), ['jp1', 'jp2']);
    assert.deepEqual(ids(sel.usernames), ['pablo_legacy', 'px_name', 'zelda']);
    assert.deepEqual(ids(sel.notifications), ['p1/n1', 'p1/n2', 'p2/n3']);
    assert.deepEqual(ids(sel.perUid.notifications), ['p2']);
    assert.deepEqual(ids(sel.perUid.payroll), ['p1']);
    assert.deepEqual(ids(sel.perUid.kpi_evals), ['p2']);
    assert.deepEqual(ids(sel.perUid.kpi_targets), ['p1']);
    assert.deepEqual(ids(sel.perUid.leave_balances), ['p2']);
    assert.deepEqual(ids(sel.perUid.attendance), ['p1']);
    assert.deepEqual(ids(sel.perUid['attendance/records']), ['p1/2026-01-01']);
    assert.deepEqual(ids(sel.perUid.personal_todos), ['p1']);
    assert.deepEqual(ids(sel.perUid['personal_todos/items']), ['p1/t1']);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('buckets, paths, safety checks', () => {
  it('bucketsOf lists children before parents and the users docs last; pathFor builds root and sub-document paths', () => {
    const sel = select(inputFromSeed(worldSeed(), worldAuth()));
    const kids = { 'conversations/messages': [rec('c_w/m1', {})], 'conversations/readers': [], 'conversations/typing': [] };
    const keys = bucketsOf(sel, kids).map((b) => b.key);
    assert.equal(keys[keys.length - 1], 'users');
    assert.ok(keys.indexOf('conversations/messages') < keys.indexOf('conversations'));
    assert.ok(keys.indexOf('attendance/records') < keys.indexOf('attendance'));
    assert.ok(keys.indexOf('notifications/items') < keys.indexOf('notifications'));
    assert.ok(keys.indexOf('personal_todos/items') < keys.indexOf('personal_todos'));
    for (const k of ['sops', 'posts', 'approval_requests', 'bs_quotes', 'partner_deals', 'usernames', 'payroll', 'kpi_evals', 'kpi_targets', 'leave_balances']) assert.ok(keys.indexOf(k) >= 0 && keys.indexOf(k) < keys.length - 1, k);
    assert.equal(keys.indexOf('job_projects'), -1);
    assert.equal(pathFor('bs_quotes', 'abc'), 'bs_quotes/abc');
    assert.equal(pathFor('conversations/messages', 'c1/m9'), 'conversations/c1/messages/m9');
    assert.equal(pathFor('attendance/records', 'u1/2026-01-01'), 'attendance/u1/records/2026-01-01');
  });

  it('pathFor never guesses: a malformed id throws instead of pointing somewhere else', () => {
    assert.throws(() => pathFor('bs_quotes', ''), /empty/);
    assert.throws(() => pathFor('bs_quotes', 'a/b'), /slash/);
    assert.throws(() => pathFor('conversations/messages', 'nosplit'), /parentId\/subId/);
    assert.throws(() => pathFor('conversations/messages', '/m1'), /parentId\/subId/);
    assert.throws(() => pathFor('conversations/messages', 'c1/'), /parentId\/subId/);
    assert.throws(() => pathFor('conversations/messages', undefined), /empty/);
  });

  it('safetyProblems: refuses an empty users collection, removing every account, and removing the last president/owner', () => {
    const users = [rec('boss', { role: 'president' }), rec('p', { role: 'partner' }), rec('e', { role: 'employee' })];
    assert.deepEqual(safetyProblems(select({ users }), { users }), []);
    assert.match(safetyProblems(select({ users: [] }), { users: [] })[0], /empty/);
    const all = [rec('p', { role: 'partner' }), rec('q', { role: 'partner' })];
    assert.ok(safetyProblems(select({ users: all }), { users: all }).some((p) => /every account/.test(p)));
    const noBoss = [rec('p', { role: 'partner' }), rec('e', { role: 'employee' }), rec('m', { role: 'manager' })];
    assert.ok(safetyProblems(select({ users: noBoss }), { users: noBoss }).some((p) => /president\/owner/.test(p)));
    const owner = [rec('p', { role: 'partner' }), rec('o', { role: ' Owner ' })];
    assert.deepEqual(safetyProblems(select({ users: owner }), { users: owner }), []);
    // the president being marked "needs a look" (not selected) keeps them: fine
    const prez = [rec('boss', { role: 'president', title: 'Partner' }), rec('p', { role: 'partner' })];
    assert.deepEqual(safetyProblems(select({ users: prez }), { users: prez }), []);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('the group-chat edit — pure helpers', () => {
  const P = new Set(['p1', 'p2']);
  const richDoc = () => rec('g', {
    participants: ['s1', 'p1', 's2', 'p2', 'p1'],
    participantNames: { s1: 'A', p1: 'B', p2: 'C' }, reads: { p2: 1, s2: 2 }, pinnedBy: { s1: true }, mutedBy: { p1: true }, archivedBy: { p2: true, s2: true },
    lastMessageBy: 'p1', lastMessageText: 'hello', lastMessageByName: 'B', pinnedMsgIds: ['m1', 'm2', 'm3'],
  });

  it('groupEditFor lists exactly what names a partner on a kept group chat — and returns null when nothing does', () => {
    const doc = richDoc();
    const e = groupEditFor(doc, P);
    assert.deepEqual(e.partnerUids, ['p1', 'p2']);
    assert.deepEqual(e.mapKeys, { participantNames: ['p1', 'p2'], reads: ['p2'], mutedBy: ['p1'], archivedBy: ['p2'] });
    assert.equal(e.clearLast, true);
    assert.equal(e.record, doc);
    assert.equal(e.id, 'g');
    // a staff-only doc: nothing to do
    assert.equal(groupEditFor(rec('g', { participants: ['s1', 's2'], participantNames: { s1: 'A' }, reads: { s2: 1 }, lastMessageBy: 's1', lastMessageText: 'x', pinnedMsgIds: ['m1'] }), P), null);
    // the preview already blanked (the state AFTER the edit): nothing left, so a repeat run is quiet
    assert.equal(groupEditFor(rec('g', { participants: ['s1', 's2'], lastMessageBy: 'p1', lastMessageText: null, lastMessageByName: null }), P), null);
    // a partner's preview with only the name left is still blanked
    assert.equal(groupEditFor(rec('g', { participants: ['s1', 's2'], lastMessageBy: 'p1', lastMessageText: null, lastMessageByName: 'B' }), P).clearLast, true);
    // the preview of a STAFF message is never blanked
    assert.equal(groupEditFor(rec('g', { participants: ['s1', 's2', 'p1'], lastMessageBy: 's1', lastMessageText: 'x', lastMessageByName: 'A' }), P).clearLast, false);
    // the partner already gone from the member list but still keyed in a per-member map: still something to change (the verification relies on it)
    const keyed = groupEditFor(rec('g', { participants: ['s1', 's2'], reads: { p1: 1, s1: 2 }, archivedBy: { s2: true } }), P);
    assert.deepEqual(keyed.partnerUids, []);
    assert.deepEqual(keyed.mapKeys, { reads: ['p1'] });
    assert.equal(keyed.clearLast, false);
    assert.deepEqual(Object.keys(buildGroupPatch(keyed, FV)), ['reads.p1'], 'no member-list change is written when the partner is not in it');
    // ...and so is a partner preview alone
    const previewOnly = groupEditFor(rec('g', { participants: ['s1', 's2'], lastMessageBy: 'p2', lastMessageText: 'x' }), P);
    assert.deepEqual(Object.keys(buildGroupPatch(previewOnly, FV)).sort(), ['lastMessageByName', 'lastMessageText']);
    // fields of the wrong shape are ignored, not crashed on
    assert.equal(groupEditFor(rec('g', { participants: 'p1', reads: ['p1'], participantNames: null, pinnedBy: 5 }), P), null);
    assert.equal(groupEditFor({ id: 'g' }, P), null);
  });

  it('buildGroupPatch writes ONLY the planned keys, as atomic FieldValue operations, and refuses a uid that is unsafe in a field path', () => {
    const patch = buildGroupPatch(groupEditFor(richDoc(), P), FV);
    assert.deepEqual(Object.keys(patch).sort(), ['archivedBy.p2', 'lastMessageByName', 'lastMessageText', 'mutedBy.p1', 'participantNames.p1', 'participantNames.p2', 'participants', 'reads.p2']);
    assert.deepEqual(patch.participants, { __fv: 'arrayRemove', values: ['p1', 'p2'] });
    assert.deepEqual(patch['reads.p2'], { __fv: 'delete' });
    assert.deepEqual(patch['mutedBy.p1'], { __fv: 'delete' });
    assert.equal(patch.lastMessageText, null);
    assert.equal(patch.lastMessageByName, null);
    assert.ok(!('lastMessageBy' in patch) && !('lastMessageAt' in patch) && !('participantNames' in patch) && !('pinnedMsgIds' in patch), 'a whole field would be overwritten');
    // a minimal edit touches only the member list
    assert.deepEqual(Object.keys(buildGroupPatch(groupEditFor(rec('g', { participants: ['s1', 's2', 'p1'] }), P), FV)), ['participants']);
    // applied to the doc, only the partner's entries disappear
    const applied = applyPatch(richDoc().data, patch);
    assert.deepEqual(applied.participants, ['s1', 's2']);
    assert.deepEqual(applied.participantNames, { s1: 'A' });
    assert.deepEqual(applied.reads, { s2: 2 });
    assert.deepEqual(applied.pinnedBy, { s1: true });
    assert.deepEqual(applied.archivedBy, { s2: true });
    assert.deepEqual(applied.mutedBy, {});
    assert.deepEqual(applied.pinnedMsgIds, ['m1', 'm2', 'm3']);                       // pins are left alone
    assert.equal(applied.lastMessageBy, 'p1');
    // a uid with a dot, a slash or a space cannot be put in "reads.<uid>"
    for (const bad of ['p.1', 'p/1', 'p 1', '', '$x']) {
      const edit = groupEditFor(rec('g', { participants: ['s1', 's2', bad], reads: { [bad]: 1 } }), new Set([bad]));
      assert.throws(() => buildGroupPatch(edit, FV), /cannot be used in a field path/, JSON.stringify(bad));
    }
    // ...but a dot in a uid that only appears in participants (no map key) is fine: arrayRemove takes any value
    assert.doesNotThrow(() => buildGroupPatch(groupEditFor(rec('g', { participants: ['s1', 's2', 'p.1'] }), new Set(['p.1'])), FV));
  });

  it('groupPartnerChildren returns only the partners\' own children of the listed groups', () => {
    const kids = {
      'conversations/messages': [rec('g1/a', { authorId: 'p1' }), rec('g1/b', { authorId: 's1' }), rec('g2/a', { authorId: 'p2' }), rec('g3/a', { authorId: 'p1' }), rec('noslash', { authorId: 'p1' }), rec('g1/c', {})],
      'conversations/readers': [rec('g1/p1', {}), rec('g1/s1', {}), rec('g3/p1', {})],
      'conversations/typing': [rec('g2/p2', {}), rec('g2/s9', {})],
    };
    const r = groupPartnerChildren(kids, new Set(['g1', 'g2']), P);
    assert.deepEqual(ids(r.messages), ['g1/a', 'g2/a']);
    assert.deepEqual(ids(r.readers), ['g1/p1']);
    assert.deepEqual(ids(r.typing), ['g2/p2']);
    assert.deepEqual(groupPartnerChildren(undefined, new Set(['g1']), P), { messages: [], readers: [], typing: [] });
    assert.deepEqual(groupPartnerChildren(kids, new Set(), P), { messages: [], readers: [], typing: [] });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('the report — counts only', () => {
  const sel = select(inputFromSeed(worldSeed(), worldAuth()));
  const kids = { 'conversations/messages': Array.from({ length: 8 }, (_, i) => rec('c/' + i, {})), 'conversations/readers': [rec('c_w/p1', {})], 'conversations/typing': [rec('c_w/p2', {})] };
  const rep = summarize(sel, { children: kids, read: { users: 10 }, authUids: worldAuth().map((u) => u.uid) });

  it('summarize carries the numbers the owner needs', () => {
    assert.deepEqual(rep.accounts, { total: 4, withProfile: 3, viaRole: 2, viaMarkerOnly: 1, authOnly: 1, authFound: 3 });
    assert.deepEqual(rep.needsLook, { users: 1, auth: 0, bsQuotes: 1 });
    assert.equal(rep.bsOnlyNonPartner, 1);
    assert.deepEqual(rep.bsQuotes, { selected: 7, viaRoleOnly: 1, keptStaff: 4 });
    assert.deepEqual(rep.conversations, { whollyPartner: 3, direct: 4, directMessages: 1, staffAffected: 3 });
    assert.deepEqual(rep.groups, { partnerRemoved: 2, partnerMessagesDeleted: 3, partnerMarksDeleted: 3 });
    assert.deepEqual(rep.jobProjects, { tagged: 1, createdByPartner: 2 });
    const count = (k) => rep.buckets.find((b) => b.key === k).count;
    assert.equal(count('bs_quotes'), 7);
    assert.equal(count('sops'), 2);
    assert.equal(count('conversations'), 7);                         // 3 wholly partner + 4 direct staff-partner threads; the 2 kept group chats are NOT here
    assert.equal(count('conversations/messages'), 11);               // the 8 handed in + the 3 partner messages of the kept group chats
    assert.equal(count('conversations/readers'), 3);
    assert.equal(count('conversations/typing'), 2);
    assert.equal(rep.buckets.some((b) => b.key === 'conversations-group-before-edit'), false);
    assert.equal(count('users'), 3);
    assert.equal(rep.totalDocs, rep.buckets.reduce((n, b) => n + b.count, 0));
  });

  it('the printed report contains none of the invented names, emails, phones, totals, items or message text — and no uid unless asked', () => {
    const plain = formatReport(rep, sel, { showUids: false }).join('\n');
    noLeak(plain, 'report');
    for (const uid of ['p1', 'p2', 'p3', 'px', 'adm', 'bsx']) assert.ok(!new RegExp('\\b' + uid + '\\b').test(plain), uid + ' printed without --show-uids');
    assert.match(plain, /Partner accounts to delete: 4 /);
    assert.match(plain, /Brilliant-Steel-only accounts whose role is not partner \(Q3, reported only, NOT deleted\): 1/);
    assert.match(plain, /bs_quotes: 7 /);
    assert.match(plain, /sops: 2 /);
    assert.match(plain, /conversations: 7 .*3 wholly partner, 4 direct staff-partner threads; 3 staff accounts lose a conversation/);
    assert.match(plain, /conversations\/messages: 11 .*3 of them partner messages in the kept group chats/);
    assert.match(plain, /group chats - partner removed: 2\n/);
    assert.match(plain, /partner messages deleted in group chats: 3 \(plus 3 partner read \/ typing marks\)/);
    assert.match(plain, /job_projects tagged with a partner uid: 1; created by a partner account: 2/);
    const withUids = formatReport(rep, sel, { showUids: true }).join('\n');
    noLeak(withUids, 'report with uids');
    assert.match(withUids, /partner accounts: p1 \[role, team\], p2 \[role, dept\], p3 \[title\], px \[auth claim only\]/);
    assert.match(withUids, /needs a look \(accounts\): adm/);
    assert.match(withUids, /Brilliant-Steel-only, not partner: bsx/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('backup serialisation', () => {
  it('Timestamps become ISO strings (as monthly-backup.js writes and restore-from-backup.js revives), DocumentReferences become { __ref }', () => {
    const ref = { id: 'a', path: 'users/a', collection() {}, firestore: {} };
    const v = toBackupValue({ t: TS('2026-10-28T10:00:00.000Z'), d: new Date('2026-01-01T00:00:00.000Z'), nested: { list: [TS('2026-02-03T04:05:06.000Z'), 1, 'x', null, true] }, ref, n: 5, s: 'str', z: null });
    assert.deepEqual(v, { t: '2026-10-28T10:00:00.000Z', d: '2026-01-01T00:00:00.000Z', nested: { list: ['2026-02-03T04:05:06.000Z', 1, 'x', null, true] }, ref: { __ref: 'users/a' }, n: 5, s: 'str', z: null });
    assert.match(v.t, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/);       // the regex restore-from-backup.js revives
    assert.doesNotThrow(() => JSON.stringify(v));
  });

  it('toBackupRecord is the flat { id, ...fields } record; the doc id always wins and a field called "id" is kept as __idField', () => {
    assert.deepEqual(toBackupRecord(rec('doc1', { a: 1, t: TS('2026-10-28T10:00:00.000Z') })), { id: 'doc1', a: 1, t: '2026-10-28T10:00:00.000Z' });
    assert.deepEqual(Object.keys(toBackupRecord(rec('doc1', { a: 1 }))), ['id', 'a']);
    assert.deepEqual(toBackupRecord(rec('real', { id: 'someone-else', a: 1 })), { id: 'real', a: 1, __idField: 'someone-else' });
    assert.deepEqual(toBackupRecord({ id: 'x' }), { id: 'x' });
  });

  it('toAuthRecord keeps Auth metadata and NEVER a password hash or salt', () => {
    const r = toAuthRecord(authUser('p1', 'a@b.example', { role: 'partner' }, { phoneNumber: '+63 900 000 0000' }));
    assert.equal(r.uid, 'p1');
    assert.equal(r.email, 'a@b.example');
    assert.deepEqual(r.customClaims, { role: 'partner' });
    assert.deepEqual(r.providerIds, ['password']);
    assert.equal(r.disabled, false);
    assert.equal(r.creationTime, 'Mon, 05 Jan 2026 00:00:00 GMT');
    const dump = JSON.stringify(r);
    assert.ok(!/passwordHash|passwordSalt|HASH-abc123|SALT-xyz789/.test(dump));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('run — a dry run reads and reports, and writes nothing', () => {
  it('writes NOTHING (no delete, no Auth delete, no file) and prints counts only', async () => {
    for (const opts of [undefined, {}, { apply: false }, { apply: false, showUids: false }]) {
      const env = makeEnv();
      const r = await run(env.deps, Object.assign({ log: env.out.log }, opts));
      assert.equal(r.exitCode, 0);
      assert.equal(r.backup, null);
      assert.deepEqual(env.db.requested, []);
      assert.deepEqual(env.auth.requested, []);
      assert.deepEqual(env.io.writes, []);
      assert.equal(env.db.commits, 0);
      assert.deepEqual(env.db.updates, [], 'a dry run edited a group chat');
      assert.equal(env.db.store.size, Object.keys(env.seed).length);
      assert.deepEqual(env.db.store.get('conversations/c_m2'), env.seed['conversations/c_m2']);
      assert.equal(env.auth.store.size, worldAuth().length);
      const t = text(env);
      noLeak(t, 'dry run');
      assert.match(t, /DRY RUN/);
      assert.match(t, /Partner accounts to delete: 4 /);
      assert.match(t, /Documents to delete: 57 in total/);
      assert.match(t, /group chats - partner removed: 2\n/);
      assert.match(t, /partner messages deleted in group chats: 3 /);
      assert.match(t, /Brilliant-Steel-only accounts whose role is not partner \(Q3, reported only, NOT deleted\): 1/);
      assert.match(t, /DRY RUN - nothing was deleted/);
      assert.ok(!/Verification/.test(t), 'a dry run does not verify anything');
    }
  });

  it('--show-uids adds the partner uids and still no name, email, phone or figure', async () => {
    const env = makeEnv();
    await run(env.deps, { log: env.out.log, showUids: true });
    const t = text(env);
    noLeak(t, 'dry run --show-uids');
    assert.match(t, /partner accounts: p1 \[role, team\], p2 \[role, dept\], p3 \[title\], px \[auth claim only\]/);
  });

  it('pages through every Auth account (the Auth-only partner is on the last page)', async () => {
    const env = makeEnv({ pageSize: 2 });
    await run(env.deps, { log: env.out.log });
    assert.equal(env.auth.listCalls, 5);
    assert.match(text(env), /Partner accounts to delete: 4 /);
    assert.match(text(env), /Auth accounts found for them: 3 of 4/);
  });

  it('warns on an empty users collection (wrong project) and still writes nothing', async () => {
    const env = makeEnv({ seed: { 'bs_quotes/q': { createdByRole: 'partner' } }, auth: [] });
    const r = await run(env.deps, { log: env.out.log });
    assert.equal(r.exitCode, 0);
    assert.match(text(env), /SAFETY: the users collection is empty/);
    assert.match(text(env), /WARNING: the users collection is empty/);
    assert.deepEqual(env.db.requested, []);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('run — the backup', () => {
  const FILES = sorted([
    'approval_requests.json', 'attendance.json', 'attendance__records.json', 'auth-users.json', 'bs_quotes.json',
    'conversations-group-before-edit.json', 'conversations.json', 'conversations__messages.json', 'conversations__readers.json', 'conversations__typing.json',
    'kpi_evals.json', 'kpi_targets.json', 'leave_balances.json', 'manifest.json', 'notifications.json', 'notifications__items.json',
    'partner_deals.json', 'payroll.json', 'personal_todos.json', 'personal_todos__items.json', 'posts.json', 'sops.json', 'usernames.json', 'users.json',
  ]);
  const read = (env, name) => JSON.parse(env.io.files.get(path.join(BK, name)));

  it('--backup alone writes one file per bucket + auth-users.json + manifest.json LAST, and deletes nothing', async () => {
    const env = makeEnv();
    const r = await run(env.deps, { backupDir: BK, log: env.out.log, projectId: 'barro-test' });
    assert.equal(r.exitCode, 0);
    assert.equal(r.backup.complete, true);
    assert.deepEqual(env.db.requested, []);
    assert.deepEqual(env.auth.requested, []);
    assert.deepEqual(sorted(Array.from(env.io.files.keys()).map((p) => path.basename(p))), FILES);
    assert.equal(env.io.writes[env.io.writes.length - 1], mf(BK), 'manifest.json must be written last');
    assert.equal(env.io.writes.filter((p) => p === mf(BK)).length, 1);
    const m = read(env, 'manifest.json');
    assert.equal(m.complete, true);
    assert.equal(m.mode, 'backup-only');
    assert.equal(m.projectId, 'barro-test');
    assert.equal(m.createdAt, '2026-10-30T12:00:00.000Z');
    assert.equal(m.selectionVersion, 1);
    assert.deepEqual(sorted(m.files.map((f) => f.file)), FILES.filter((f) => f !== 'manifest.json'));
    for (const f of m.files) {
      const body = env.io.files.get(path.join(BK, f.file));
      assert.equal(f.sha256, sha(body), f.file);
      assert.equal(f.records, JSON.parse(body).length, f.file);
    }
    noLeak(JSON.stringify(m), 'manifest');
    noLeak(text(env), 'backup log');
  });

  it('every bucket file holds exactly its records, flat, with Timestamps as ISO strings; the conversations carry ALL their sub-collections', async () => {
    const env = makeEnv();
    await run(env.deps, { backupDir: BK, log: env.out.log });
    assert.deepEqual(read(env, 'users.json').map((u) => u.id).sort(), ['p1', 'p2', 'p3']);
    const u1 = read(env, 'users.json').find((u) => u.id === 'p1');
    assert.equal(u1.email, 'zelda.q@partnerco.example');                      // the backup is the record: full docs
    assert.equal(u1.createdAt, '2026-01-02T03:04:05.000Z');
    assert.deepEqual(read(env, 'bs_quotes.json').map((q) => q.id).sort(), ['draft_p1', 'draft_p3', 'q_p1', 'q_p2', 'q_pt', 'q_role', 'qd_by']);
    assert.equal(read(env, 'bs_quotes.json')[0].total, 987654.32);
    assert.deepEqual(read(env, 'sops.json').map((q) => q.id).sort(), ['sop_edit', 'sop_seed']);
    assert.deepEqual(read(env, 'partner_deals.json').map((q) => q.id).sort(), ['deal1', 'deal2']);
    assert.deepEqual(read(env, 'conversations.json').map((q) => q.id).sort(), ['c_m1', 'c_m3', 'c_m5', 'c_m6', 'c_w', 'c_wg', 'dept_Partners']);     // the kept group chats are NOT here
    assert.deepEqual(read(env, 'conversations__messages.json').map((q) => q.id).sort(),
      ['c_m1/m1', 'c_m1/m2', 'c_m2/m2', 'c_m3/m1', 'c_m4/m1', 'c_m4/m2', 'c_m5/m1', 'c_m6/m1', 'c_w/m1', 'c_w/m2', 'c_wg/m1', 'dept_Partners/m1']);   // c_m2/m2, c_m4/m1+m2: the partners' own, from the kept groups
    assert.deepEqual(read(env, 'conversations__readers.json').map((q) => q.id).sort(), ['c_m2/p2', 'c_m4/p1', 'c_w/p1']);
    assert.deepEqual(read(env, 'conversations__typing.json').map((q) => q.id).sort(), ['c_m2/p2', 'c_w/p2']);
    // the kept group chats are backed up as they were BEFORE the partner was taken out
    const orig = read(env, 'conversations-group-before-edit.json');
    assert.deepEqual(orig.map((q) => q.id), ['c_m2', 'c_m4']);
    assert.deepEqual(orig[0].participants, ['emp1', 'emp2', 'mgr', 'p2']);
    assert.equal(orig[0].participantNames.p2, 'Pablo Partnerson');
    assert.equal(orig[0].reads.p2, '2026-05-03T00:00:00.000Z');
    assert.deepEqual(orig[0].pinnedMsgIds, ['m1', 'm2']);
    assert.equal(orig[0].lastMessageText, 'SECRET-MESSAGE-BODY-xyz');
    assert.deepEqual(orig[1].participants, ['emp1', 'mgr', 'p1', 'p3']);
    const entry = read(env, 'manifest.json').files.find((f) => f.file === 'conversations-group-before-edit.json');
    assert.equal(entry.kind, 'edited-originals');
    assert.equal(entry.collection, 'conversations');
    assert.equal(entry.records, 2);
    assert.equal(read(env, 'conversations__messages.json')[0].text, 'SECRET-MESSAGE-BODY-xyz');
    assert.equal(read(env, 'conversations__messages.json')[0].createdAt, '2026-04-05T06:07:08.000Z');
    assert.deepEqual(read(env, 'notifications__items.json').map((q) => q.id).sort(), ['p1/n1', 'p1/n2', 'p2/n3']);
    assert.deepEqual(read(env, 'notifications.json').map((q) => q.id), ['p2']);
    assert.deepEqual(read(env, 'payroll.json').map((q) => q.id), ['p1']);
    assert.deepEqual(read(env, 'usernames.json').map((q) => q.id).sort(), ['pablo_legacy', 'px_name', 'zelda']);
    assert.deepEqual(read(env, 'approval_requests.json').map((q) => q.id).sort(), ['ap1', 'ap2']);
    assert.deepEqual(read(env, 'posts.json').map((q) => q.id).sort(), ['po1', 'po2']);
    assert.deepEqual(read(env, 'attendance__records.json').map((q) => q.id), ['p1/2026-01-01']);
    assert.deepEqual(read(env, 'personal_todos__items.json').map((q) => q.id), ['p1/t1']);
  });

  it('auth-users.json holds the partner uids\' Auth metadata — and no password hash or salt; an uid with no Auth account is marked found:false', async () => {
    const env = makeEnv();
    await run(env.deps, { backupDir: BK, log: env.out.log });
    const raw = env.io.files.get(path.join(BK, 'auth-users.json'));
    assert.ok(!/passwordHash|passwordSalt|HASH-abc123|SALT-xyz789/.test(raw));
    const a = JSON.parse(raw);
    assert.deepEqual(a.map((x) => x.uid), ['p1', 'p2', 'p3', 'px']);
    assert.equal(a.find((x) => x.uid === 'p1').email, 'zelda.q@partnerco.example');
    assert.deepEqual(a.find((x) => x.uid === 'p1').customClaims, { role: 'partner', departments: ['Brilliant Steel'] });
    assert.deepEqual(a.find((x) => x.uid === 'p3'), { uid: 'p3', found: false });
    assert.ok(!a.some((x) => ['pres', 'mgr', 'emp1', 'adm', 'bsx'].indexOf(x.uid) >= 0), 'a staff Auth account was exported');
  });

  it('refuses a directory that already holds a manifest.json — before reading anything', async () => {
    const env = makeEnv({ io: Object.assign(memIo(), {}) });
    env.io.files.set(mf(BK), '{}');
    await assert.rejects(() => run(env.deps, { backupDir: BK, log: env.out.log }), /already holds a manifest\.json/);
    await assert.rejects(() => run(env.deps, { backupDir: BK, apply: true, log: env.out.log }), /already holds a manifest\.json/);
    assert.deepEqual(env.db.reads, []);
    assert.equal(env.auth.listCalls, 0);
    assert.deepEqual(env.db.requested, []);
  });

  it('refuses a backup directory INSIDE this repository (the export holds personal data and the repository is public) — before reading anything', async () => {
    for (const dir of [path.join(REPO, 'purge-backup'), path.join(REPO, 'scripts', 'x'), REPO, path.join(REPO.toUpperCase(), 'Y'), path.join(REPO, '..', path.basename(REPO), 'z')]) {
      for (const apply of [false, true]) {
        const env = makeEnv();
        await assert.rejects(() => run(env.deps, { backupDir: dir, apply, log: env.out.log }), /is inside this repository/, dir);
        assert.deepEqual(env.db.reads, []);
        assert.equal(env.auth.listCalls, 0);
        assert.deepEqual(env.io.writes, []);
        assert.deepEqual(env.io.dirs.size, 0);
      }
    }
    // a SIBLING whose name merely starts like the repository's is outside it
    const env = makeEnv();
    const r = await run(env.deps, { backupDir: REPO + '-purge-backup', log: env.out.log });
    assert.equal(r.backup.complete, true);
    // insideRepo itself, with an explicit root
    assert.equal(insideRepo('/a/b/c', '/a/b'), true);
    assert.equal(insideRepo('/a/b', '/a/b'), true);
    assert.equal(insideRepo('/A/B/c', '/a/b'), true);
    assert.equal(insideRepo('/a/b/../b/c', '/a/b'), true);
    assert.equal(insideRepo('/a/bc', '/a/b'), false);
    assert.equal(insideRepo('/a', '/a/b'), false);
    assert.equal(insideRepo('/x/y', '/a/b'), false);
  });

  it('a short or corrupted write is caught by the read-back: the run stops, and with --apply NOTHING has been deleted', async () => {
    const cut = (p, t) => (path.basename(p) === 'bs_quotes.json' ? t.slice(0, Math.floor(t.length / 2)) : t);
    const env1 = makeEnv({ io: memIo({ corrupt: cut }) });
    await assert.rejects(() => run(env1.deps, { backupDir: BK, log: env1.out.log }), /backup check failed: bs_quotes\.json/);
    assert.ok(!env1.io.files.has(mf(BK)), 'a manifest must not exist for an incomplete backup');
    const env2 = makeEnv({ io: memIo({ corrupt: cut }) });
    await assert.rejects(() => run(env2.deps, { backupDir: BK, apply: true, log: env2.out.log }), /backup check failed/);
    assert.deepEqual(env2.db.requested, []);
    assert.deepEqual(env2.auth.requested, []);
    assert.equal(env2.db.store.size, Object.keys(env2.seed).length);
    // a file that reads back different from what was written (bit rot) is caught too
    const rot = memIo();
    const realRead = rot.read;
    rot.read = (p) => (path.basename(p) === 'users.json' ? realRead(p).replace('Zelda', 'Zeldb') : realRead(p));     // same length, same records: only the checksum differs
    const env3 = makeEnv({ io: rot });
    await assert.rejects(() => run(env3.deps, { backupDir: BK, apply: true, log: env3.out.log }), /backup check failed: users\.json does not match what was written/);
    assert.deepEqual(env3.db.requested, []);
    // and a manifest that cannot be read back
    const env4 = makeEnv({ io: memIo({ corrupt: (p, t) => (path.basename(p) === 'manifest.json' ? '{ not json' : t) }) });
    await assert.rejects(() => run(env4.deps, { backupDir: BK, apply: true, log: env4.out.log }), /manifest\.json is not readable back/);
    assert.deepEqual(env4.db.requested, []);
  });

  it('a field literally named "id" cannot redirect a delete or lose its value', async () => {
    const seed = worldSeed();
    seed['bs_quotes/real'] = { id: 'someone-else', createdBy: 'p1', company: 'BS' };
    const env = makeEnv({ seed });
    await run(env.deps, { backupDir: BK, apply: true, log: env.out.log });
    assert.ok(env.db.requested.indexOf('bs_quotes/real') >= 0);
    assert.ok(env.db.requested.indexOf('bs_quotes/someone-else') < 0);
    const row = read(env, 'bs_quotes.json').find((q) => q.id === 'real');
    assert.equal(row.__idField, 'someone-else');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('run — --apply', () => {
  const go = (env, extra) => run(env.deps, Object.assign({ apply: true, backupDir: BK, log: env.out.log, projectId: 'barro-test' }, extra || {}));

  it('REFUSES without a backup directory — before reading anything', async () => {
    const env = makeEnv();
    for (const opts of [{ apply: true }, { apply: true, backupDir: '' }, { apply: true, backupDir: null }]) {
      await assert.rejects(() => run(env.deps, Object.assign({ log: env.out.log }, opts)), /--apply needs --backup/);
    }
    assert.deepEqual(env.db.reads, []);
    assert.equal(env.auth.listCalls, 0);
    assert.deepEqual(env.db.requested, []);
    assert.deepEqual(env.io.writes, []);
  });

  it('only apply === true deletes ("true", 1, "yes" are not enough)', async () => {
    for (const apply of ['true', 1, 'yes', {}]) {
      const env = makeEnv();
      const r = await run(env.deps, { apply, backupDir: BK, log: env.out.log });
      assert.equal(r.apply, false);
      assert.deepEqual(env.db.requested, []);
      assert.deepEqual(env.auth.requested, []);
    }
  });

  it('deletes exactly the selected documents and Auth users — and nothing else', async () => {
    const env = makeEnv();
    const r = await go(env);
    assert.equal(r.exitCode, 0);
    assert.deepEqual(sorted(env.db.requested), EXPECTED_DELETES);
    assert.deepEqual(sorted(env.db.deleted), EXPECTED_DELETES);
    assert.equal(new Set(env.db.requested).size, env.db.requested.length, 'a document was deleted twice');
    assert.deepEqual(sorted(env.auth.requested), EXPECTED_AUTH_DELETES);
    assert.deepEqual(sorted(Array.from(env.auth.store.keys())), ['adm', 'bsx', 'bsy', 'emp1', 'emp2', 'mgr', 'pres']);
    // every other document is untouched, byte for byte — except the two kept group chats, which have exactly the partner taken out
    const kept = Object.keys(env.seed).filter((p) => EXPECTED_DELETES.indexOf(p) < 0);
    assert.deepEqual(sorted(Array.from(env.db.store.keys())), sorted(kept));
    const after = expectedGroupAfter();
    for (const p of kept) assert.deepEqual(env.db.store.get(p), after[p] || env.seed[p], p + ' changed');
    assert.deepEqual(sorted(env.db.updates.map((u) => u.path)), EXPECTED_GROUP_EDITS);
    for (const u of env.db.updates) assert.ok(kept.indexOf(u.path) >= 0 && /^conversations\/c_m[24]$/.test(u.path), u.path + ' was edited');
    // specific survivors the owner rulings and the guards promise
    for (const p of ['users/pres', 'users/mgr', 'users/emp1', 'users/emp2', 'users/adm', 'users/bsx', 'users/bsy', 'bs_quotes/s1', 'bs_quotes/s2', 'bs_quotes/s_pres', 'bs_quotes/draft_emp1',
      'bs_quotes/s_mis', 'job_projects/jp1', 'job_projects/jp2', 'job_projects/jp3', 'conversations/c_s', 'conversations/dept_Sales', 'conversations/dept_Finance', 'conversations/c_np',
      'conversations/c_m2', 'conversations/c_m4', 'conversations/c_m2/messages/m1', 'conversations/c_m2/messages/m3', 'conversations/c_m2/readers/emp1', 'conversations/c_m4/messages/m3',
      'conversations/c_m4/readers/mgr',
      'sops/sop_dealer', 'sops/sop_daily', 'sops/sop_notitle', 'usernames/eli', 'payroll/emp1', 'approval_requests/ap3', 'approval_requests/ap4', 'posts/po3', 'posts/po4']) {
      assert.ok(env.db.store.has(p), p + ' was deleted');
    }
    assert.deepEqual(r.deleted.users, 3);
    assert.deepEqual(r.deleted['Auth accounts'], 3);
    assert.equal(r.deleted['conversations/messages'], 12);
    assert.equal(r.deleted.conversations, 7);
    assert.equal(r.deleted['group chats - partner removed'], 2);
    assert.equal(r.deleted.sops, 2);
    assert.equal(r.deleted.bs_quotes, 7);
  });

  it('writes nothing but deletes and the group-chat edits: the fake has no set/add, so any other write would have thrown', async () => {
    const env = makeEnv();
    for (const m of ['set', 'update', 'add', 'create']) {
      assert.equal(typeof env.db[m], 'undefined');
      assert.equal(typeof env.db.doc('x/y')[m], 'undefined');
    }
    assert.equal(typeof env.db.batch().set, 'undefined');
    assert.equal(typeof env.db.batch().update, 'function');
    await go(env);
    // the only updates are the two edits, each carrying nothing but FieldValue operations and the blanked preview
    assert.equal(env.db.updates.length, 2);
    const c2 = env.db.updates.find((u) => u.path === 'conversations/c_m2').patch;
    assert.deepEqual(Object.keys(c2).sort(), ['archivedBy.p2', 'lastMessageByName', 'lastMessageText', 'mutedBy.p2', 'participantNames.p2', 'participants', 'pinnedBy.p2', 'reads.p2']);   // one key per per-member map that names the partner
    assert.deepEqual(c2.participants, { __fv: 'arrayRemove', values: ['p2'] });
    assert.deepEqual(c2['reads.p2'], { __fv: 'delete' });
    assert.equal(c2.lastMessageText, null);
    assert.equal(c2.lastMessageByName, null);
    const c4 = env.db.updates.find((u) => u.path === 'conversations/c_m4').patch;
    assert.deepEqual(Object.keys(c4).sort(), ['participantNames.p1', 'participantNames.p3', 'participants']);
    assert.deepEqual(c4.participants, { __fv: 'arrayRemove', values: ['p1', 'p3'] });
  });

  it('orders the work: children before parents, data first, then the Auth accounts, the users docs LAST', async () => {
    const env = makeEnv();
    await go(env);
    const ev = env.events;
    const firstAuth = ev.findIndex((e) => e.t === 'auth-delete');
    const lastAuth = ev.map((e) => e.t).lastIndexOf('auth-delete');
    const userIdx = ev.map((e, i) => (e.t === 'fs-delete' && e.path.indexOf('users/') === 0 ? i : -1)).filter((i) => i >= 0);
    const dataIdx = ev.map((e, i) => (e.t === 'fs-delete' && e.path.indexOf('users/') !== 0 ? i : -1)).filter((i) => i >= 0);
    assert.ok(firstAuth > Math.max(...dataIdx), 'an Auth account was deleted before all the data was');
    assert.ok(Math.min(...userIdx) > lastAuth, 'a users doc was deleted before the Auth accounts');
    const at = (p) => ev.findIndex((e) => e.path === p);
    for (const [child, parent] of [
      ['conversations/c_w/messages/m1', 'conversations/c_w'], ['conversations/c_w/readers/p1', 'conversations/c_w'], ['conversations/c_w/typing/p2', 'conversations/c_w'],
      ['conversations/c_m1/messages/m2', 'conversations/c_m1'], ['conversations/dept_Partners/messages/m1', 'conversations/dept_Partners'],
      ['attendance/p1/records/2026-01-01', 'attendance/p1'], ['notifications/p2/items/n3', 'notifications/p2'], ['personal_todos/p1/items/t1', 'personal_todos/p1'],
    ]) assert.ok(at(child) >= 0 && at(child) < at(parent), child + ' must go before ' + parent);
    // a kept group chat is edited only AFTER the partner's messages in it are gone (a repeat run could not find them otherwise), and before the Auth step
    const upd = ev.map((e, i) => (e.t === 'fs-update' ? i : -1)).filter((i) => i >= 0);
    assert.equal(upd.length, 2);
    for (const [child, parent] of [['conversations/c_m2/messages/m2', 'conversations/c_m2'], ['conversations/c_m2/readers/p2', 'conversations/c_m2'], ['conversations/c_m2/typing/p2', 'conversations/c_m2'],
      ['conversations/c_m4/messages/m1', 'conversations/c_m4'], ['conversations/c_m4/messages/m2', 'conversations/c_m4'], ['conversations/c_m4/readers/p1', 'conversations/c_m4']]) {
      const edit = ev.findIndex((e) => e.t === 'fs-update' && e.path === parent);
      assert.ok(at(child) >= 0 && edit > at(child), parent + ' was edited before ' + child + ' was deleted');
    }
    assert.ok(Math.max(...upd) < firstAuth, 'a group chat was edited after the Auth accounts');
    assert.ok(Math.min(...upd) > Math.max(...dataIdx), 'a group chat was edited before the deletes were done');
  });

  it('deletes in batches of at most 400 (and only fills them as far as needed)', async () => {
    const seed = worldSeed();
    for (let i = 0; i < 950; i++) seed['notifications/p1/items/big' + i] = { title: 'x' + i };
    const env = makeEnv({ seed });
    await go(env);
    assert.ok(env.db.batchSizes.length > 3);
    assert.ok(Math.max(...env.db.batchSizes) <= 400, 'a batch held ' + Math.max(...env.db.batchSizes));
    assert.ok(env.db.batchSizes.indexOf(400) >= 0, 'batches are not being filled');
    assert.equal(env.db.batchSizes.reduce((a, b) => a + b, 0), EXPECTED_DELETES.length + 950 + 2);       // + the two group-chat edits
    assert.equal(env.db.requested.filter((p) => /^notifications\/p1\/items\//.test(p)).length, 952);
  });

  it('prints counts only, in the apply log and the verification', async () => {
    const env = makeEnv();
    await go(env);
    const t = text(env);
    noLeak(t, 'apply log');
    assert.match(t, /Mode: APPLY/);
    assert.match(t, /Backup written and verified: 23 files/);
    assert.match(t, /group chats - partner removed: 2\n/);
    assert.match(t, /deleted users: 3/);
    assert.match(t, /deleted Auth accounts: 3 \(1 had no Auth account\)/);
    assert.match(t, /Verification passed: every count above is 0\./);
  });

  it('the verification re-reads Firestore and Auth and prints the spec\'s lines at zero', async () => {
    const env = makeEnv();
    const r = await go(env);
    assert.equal(r.verification.ok, true);
    assert.deepEqual(r.verification.failures, []);
    const t = text(env);
    for (const line of ['users with role partner: 0', 'partner_deals: 0', 'bs_quotes partner-made: 0', 'Auth accounts enabled with claim role partner: 0',
      'Auth accounts (any state) with claim role partner: 0', 'sops titled Partner Deal Process: 0', 'posts partner-made: 0', 'approval_requests partner-made: 0']) {
      assert.ok(t.indexOf(line) >= 0, line + ' missing');
    }
    assert.ok(r.verification.lines.every((l) => l.count === 0));
  });

  it('is repeatable: a second --apply (new backup directory) finds nothing, deletes nothing and verifies clean', async () => {
    const env = makeEnv();
    await go(env);
    const afterFirst = new Map(env.db.store);
    const requestedBefore = env.db.requested.length;
    const updatesBefore = env.db.updates.length;
    env.out.lines.length = 0;
    const r2 = await run(env.deps, { apply: true, backupDir: '/bk/two', log: env.out.log });
    assert.equal(r2.exitCode, 0);
    assert.equal(env.db.requested.length, requestedBefore);
    assert.equal(env.db.updates.length, updatesBefore, 'a group chat was edited a second time');
    assert.match(text(env), /group chats - partner removed: 0\n/);
    assert.deepEqual(env.auth.requested.length, 3);
    assert.deepEqual(Array.from(env.db.store.keys()), Array.from(afterFirst.keys()));
    assert.match(text(env), /Partner accounts to delete: 0 /);
    assert.match(text(env), /Documents to delete: 0 in total/);
    assert.equal(JSON.parse(env.io.files.get(mf('/bk/two'))).complete, true);
  });

  it('the verification catches a document that did not go (exit code 2) — found through the purged uids, whose users docs are gone', async () => {
    const env = makeEnv({ ghost: new Set(['posts/po1']) });
    const r = await go(env);
    assert.equal(r.exitCode, 2);
    assert.equal(r.verification.ok, false);
    assert.deepEqual(r.verification.failures, ['posts partner-made: 1']);
    assert.match(text(env), /VERIFICATION FAILED/);
    assert.match(text(env), /posts partner-made: 1/);
    // even a failing run lists no uid (and no name) unless asked
    noLeak(text(env), 'failing verification');
    assert.ok(!/\bp1\b|\bpx\b/.test(text(env)), 'a uid was printed without --show-uids');
    assert.match(text(env), /Run again with --show-uids/);
    const env2 = makeEnv({ ghost: new Set(['posts/po1']) });
    await go(env2, { showUids: true });
    assert.match(text(env2), /Purged partner uids to look for: p1, p2, p3, px/);
    noLeak(text(env2), 'failing verification with --show-uids');
  });

  it('the verification catches leftovers of every kind', async () => {
    const cases = [
      [{ ghost: new Set(['users/p2']) }, /users with role partner: 1/],
      [{ ghost: new Set(['partner_deals/deal2']) }, /partner_deals: 1/],
      [{ ghost: new Set(['bs_quotes/q_p1']) }, /bs_quotes partner-made: 1/],
      [{ ghost: new Set(['sops/sop_seed']) }, /sops titled Partner Deal Process: 1/],
      [{ ghost: new Set(['approval_requests/ap1']) }, /approval_requests partner-made: 1/],
      [{ ghost: new Set(['conversations/c_m1']) }, /conversations with a partner: /],
      [{ ghost: new Set(['conversations/c_w/messages/m1']) }, /sub-collection documents under the deleted documents: 1/],
      [{ ghost: new Set(['notifications/p1/items/n1']) }, /notification items: 1/],
      [{ ghost: new Set(['payroll/p1']) }, /per-uid docs .*: 1/],
      [{ ghost: new Set(['usernames/zelda']) }, /usernames docs: 1/],
      [{ authGhost: new Set(['p1']) }, /Auth accounts still existing for the purged uids: 1/],
      [{ authGhost: new Set(['p1']) }, /Auth accounts enabled with claim role partner: 1/],
      [{ authGhost: new Set(['px']) }, /Auth accounts \(any state\) with claim role partner: 1/],
      [{ ghost: new Set(['conversations/c_m2/messages/m2']) }, /partner messages left in group chats: 1/],
      [{ ghost: new Set(['conversations/c_m4/messages/m1', 'conversations/c_m4/messages/m2']) }, /partner messages left in group chats: 2/],
      [{ ghost: new Set(['conversations/c_m2/readers/p2']) }, /partner read \/ typing marks left in group chats: 1/],
      [{ ghost: new Set(['conversations/c_m2/typing/p2']) }, /partner read \/ typing marks left in group chats: 1/],
      [{ ghostUpdate: new Set(['conversations/c_m2']) }, /group chats still naming a partner \(member list, per-member map or preview\): 1/],
      [{ ghostUpdate: new Set(['conversations/c_m2', 'conversations/c_m4']) }, /group chats still naming a partner \(member list, per-member map or preview\): 2/],
    ];
    for (const [opts, re] of cases) {
      const env = makeEnv(opts);
      const r = await go(env);
      assert.equal(r.exitCode, 2, JSON.stringify([...(opts.ghost || opts.authGhost || opts.ghostUpdate)]));
      assert.match(text(env), re);
    }
  });

  it('sub-collections under ANY selected document (Firestore does not delete them with the parent) are backed up, deleted first, and verified', async () => {
    const seed = worldSeed();
    seed['bs_quotes/q_p1/versions/v1'] = { total: 987654.32 };
    seed['bs_quotes/q_p1/versions/v2'] = { total: 13579 };
    seed['users/p1/devices/d1'] = { token: 'x' };
    seed['posts/po1/comments/c1'] = { text: 'a staff reply to a partner post' };
    seed['bs_quotes/s1/versions/v1'] = { total: 1 };                                // under a STAFF quote: stays
    const env = makeEnv({ seed });
    await go(env);
    for (const [child, parent] of [['bs_quotes/q_p1/versions/v1', 'bs_quotes/q_p1'], ['bs_quotes/q_p1/versions/v2', 'bs_quotes/q_p1'], ['users/p1/devices/d1', 'users/p1'], ['posts/po1/comments/c1', 'posts/po1']]) {
      assert.ok(env.db.requested.indexOf(child) >= 0, child + ' was left behind');
      assert.ok(env.db.requested.indexOf(child) < env.db.requested.indexOf(parent), child + ' must go before ' + parent);
      assert.ok(!env.db.store.has(child));
    }
    assert.ok(env.db.store.has('bs_quotes/s1/versions/v1'), 'a staff quote\'s sub-document was deleted');
    const file = (name) => JSON.parse(env.io.files.get(path.join(BK, name)));
    assert.deepEqual(file('bs_quotes__versions.json').map((x) => x.id).sort(), ['q_p1/v1', 'q_p1/v2']);
    assert.deepEqual(file('users__devices.json').map((x) => x.id), ['p1/d1']);
    assert.deepEqual(file('posts__comments.json').map((x) => x.id), ['po1/c1']);
    const m = file('manifest.json');
    assert.deepEqual(m.files.find((f) => f.file === 'bs_quotes__versions.json'), Object.assign({}, m.files.find((f) => f.file === 'bs_quotes__versions.json'), { parentCollection: 'bs_quotes', subcollection: 'versions', records: 2 }));
    assert.match(text(env), /bs_quotes\/versions: 2/);
    assert.match(text(env), /Verification passed/);
    // a sub-document that did not go is caught
    const env2 = makeEnv({ seed, ghost: new Set(['users/p1/devices/d1']) });
    const r2 = await go(env2);
    assert.equal(r2.exitCode, 2);
    assert.match(text(env2), /sub-collection documents under the deleted documents: 1/);
  });

  it('an Auth account that is already gone is tolerated (user-not-found); any other Auth error stops the run with the users docs still in place', async () => {
    const env = makeEnv();
    const r = await go(env);
    assert.equal(r.deleted['Auth accounts'], 3);                                   // p3 had none
    const env2 = makeEnv({ failDeleteFor: new Set(['p2']) });
    await assert.rejects(() => go(env2), /internal error/);
    assert.deepEqual(env2.auth.requested, ['p1']);
    for (const u of ['p1', 'p2', 'p3']) assert.ok(env2.db.store.has('users/' + u), 'users/' + u + ' went before the Auth step finished');
    assert.match(text(env2), /APPLY FAILED part way/);
    assert.match(text(env2), /users docs are deleted last/);
  });

  it('can be repeated after a failure half way: nothing is lost track of, and a second run finishes the job', async () => {
    const env = makeEnv({ failCommitAt: 3 });
    await assert.rejects(() => go(env), /commit failed \(injected\)/);
    assert.deepEqual(env.auth.requested, []);
    for (const u of ['p1', 'p2', 'p3']) assert.ok(env.db.store.has('users/' + u));
    assert.ok(env.db.store.has('conversations/c_w'));
    assert.ok(env.db.requested.length > 0 && env.db.requested.length < EXPECTED_DELETES.length);
    assert.match(text(env), /APPLY FAILED part way/);
    assert.equal(JSON.parse(env.io.files.get(mf(BK))).complete, true, 'the first backup stays complete');
    env.db.failCommitAt = 0;
    env.out.lines.length = 0;
    const r = await run(env.deps, { apply: true, backupDir: '/bk/two', log: env.out.log });
    assert.equal(r.exitCode, 0);
    const kept = Object.keys(env.seed).filter((p) => EXPECTED_DELETES.indexOf(p) < 0);
    assert.deepEqual(sorted(Array.from(env.db.store.keys())), sorted(kept));
    const after = expectedGroupAfter();
    for (const p of kept) assert.deepEqual(env.db.store.get(p), after[p] || env.seed[p], p + ' is not as expected after the repeat');
    assert.deepEqual(sorted(env.auth.requested), EXPECTED_AUTH_DELETES);
  });

  it('a failure while the group chats are being edited is repairable: the partner is still in their member lists, so a repeat run finds and finishes them', async () => {
    const env = makeEnv();
    env.db.failOnUpdate = true;
    await assert.rejects(() => go(env), /update batch failed \(injected\)/);
    assert.deepEqual(env.auth.requested, [], 'the Auth step must not run after a failed edit');
    for (const u of ['p1', 'p2', 'p3']) assert.ok(env.db.store.has('users/' + u));
    // the partner's own messages are already gone, the partner is still listed, the docs are untouched
    assert.ok(!env.db.store.has('conversations/c_m2/messages/m2'));
    assert.deepEqual(env.db.store.get('conversations/c_m2'), env.seed['conversations/c_m2']);
    assert.match(text(env), /APPLY FAILED part way/);
    env.db.failOnUpdate = false;
    env.out.lines.length = 0;
    const r = await run(env.deps, { apply: true, backupDir: '/bk/two', log: env.out.log });
    assert.equal(r.exitCode, 0);
    const after = expectedGroupAfter();
    for (const p of EXPECTED_GROUP_EDITS) assert.deepEqual(env.db.store.get(p), after[p], p + ' is not as expected after the repair');
    assert.deepEqual(sorted(env.db.updates.map((u) => u.path)), EXPECTED_GROUP_EDITS);
    // the second backup holds the group chats as they still were (unedited), which is what an owner would restore from
    assert.deepEqual(JSON.parse(env.io.files.get(path.join('/bk/two', 'conversations-group-before-edit.json'))).map((q) => q.id), ['c_m2', 'c_m4']);
  });

  it('the group-chat edit needs FieldValue: without it --apply refuses BEFORE the backup and before anything is deleted (a dry run does not care)', async () => {
    const env = makeEnv({ noFieldValue: true });
    await assert.rejects(() => go(env), /need deps\.FieldValue/);
    assert.deepEqual(env.db.requested, []);
    assert.deepEqual(env.db.updates, []);
    assert.deepEqual(env.auth.requested, []);
    assert.deepEqual(env.io.writes, []);
    for (const bad of [{}, { arrayRemove() {} }, { delete() {} }, 'nope', 0]) {          // something is there, but it cannot do both operations
      const env3 = makeEnv();
      env3.deps.FieldValue = bad;
      await assert.rejects(() => go(env3), /need deps\.FieldValue/, JSON.stringify(bad));
      assert.deepEqual(env3.db.requested, []);
      assert.deepEqual(env3.io.writes, []);
    }
    const dry = makeEnv({ noFieldValue: true });
    const r = await run(dry.deps, { log: dry.out.log });
    assert.equal(r.exitCode, 0);
    // no kept group chat, no need for it
    const seed = worldSeed();
    ['c_m2', 'c_m4'].forEach((c) => Object.keys(seed).filter((k) => k.indexOf('conversations/' + c) === 0).forEach((k) => delete seed[k]));
    const env2 = makeEnv({ seed, noFieldValue: true });
    const r2 = await go(env2);
    assert.equal(r2.exitCode, 0);
    assert.deepEqual(env2.db.updates, []);
  });

  it('with more than 10 partners the messages are still all found (the `in` query is chunked to at most 10 values), in every kept group chat', async () => {
    const seed = worldSeed();
    const more = Array.from({ length: 12 }, (_, i) => 'xp' + i);
    more.forEach((u, i) => {
      seed['users/' + u] = { role: 'partner', displayName: 'Extra Partner ' + i, email: u + '@partnerco.example' };
      seed['conversations/c_big/messages/b' + i] = { authorId: u, text: 'SECRET-MESSAGE-BODY-xyz' };
      seed['conversations/c_big2/messages/b' + i] = { authorId: u, text: 'SECRET-MESSAGE-BODY-xyz' };
    });
    seed['conversations/c_big/messages/staff1'] = { authorId: 'emp1', text: 'kept' };
    seed['conversations/c_big'] = { type: 'group', participants: ['emp1', 'mgr', 'pres'].concat(more) };
    seed['conversations/c_big2'] = { type: 'group', participants: ['emp1', 'mgr'].concat(more.slice(0, 11)) };
    const env = makeEnv({ seed });
    const r = await go(env);
    assert.equal(r.exitCode, 0);
    for (let i = 0; i < 12; i++) assert.ok(!env.db.store.has('conversations/c_big/messages/b' + i), 'message b' + i + ' of a 12-partner group was left');
    for (let i = 0; i < 12; i++) assert.ok(!env.db.store.has('conversations/c_big2/messages/b' + i), 'message b' + i + ' of the second group was left');
    assert.ok(env.db.store.has('conversations/c_big/messages/staff1'));
    assert.deepEqual(env.db.store.get('conversations/c_big').participants, ['emp1', 'mgr', 'pres']);
    assert.deepEqual(env.db.store.get('conversations/c_big2').participants, ['emp1', 'mgr']);
    assert.ok(r.verification.ok);
  });

  it('a partner uid that cannot go into a dotted field path stops --apply before anything is touched', async () => {
    const seed = worldSeed();
    seed['users/p.dot'] = { role: 'partner' };
    seed['conversations/c_m2'] = Object.assign({}, seed['conversations/c_m2'], { participants: ['emp1', 'emp2', 'mgr', 'p.dot'], reads: { 'p.dot': TS('2026-05-03T00:00:00.000Z') } });
    const env = makeEnv({ seed });
    await assert.rejects(() => go(env), /cannot be used in a field path/);
    assert.deepEqual(env.db.requested, []);
    assert.deepEqual(env.io.writes, []);
    assert.deepEqual(env.auth.requested, []);
  });

  it('a group chat with no partner in it, and a dept channel, are never edited — a repeat of the same job on a clean world edits nothing', async () => {
    const clean = makeEnv();
    await go(clean);
    const names = Array.from(clean.db.store.keys()).filter((k) => /^conversations\/[^/]+$/.test(k));
    assert.deepEqual(sorted(names), sorted(['conversations/c_m2', 'conversations/c_m4', 'conversations/c_np', 'conversations/c_s', 'conversations/dept_Finance', 'conversations/dept_Sales']));
    assert.ok(!clean.db.updates.some((u) => ['conversations/c_s', 'conversations/dept_Sales', 'conversations/dept_Finance', 'conversations/c_np'].indexOf(u.path) >= 0));
    assert.deepEqual(clean.db.store.get('conversations/dept_Finance').participants, ['p1'], 'a department channel was edited');
  });

  it('refuses when it would remove every account or the last president — before the backup, with nothing deleted', async () => {
    const seed = { 'users/a': { role: 'partner' }, 'users/b': { role: 'Partner' } };
    const env = makeEnv({ seed, auth: [] });
    await assert.rejects(() => go(env), /refusing to apply: .*every account/);
    assert.deepEqual(env.db.requested, []);
    assert.deepEqual(env.io.writes, []);
    const seed2 = worldSeed();
    delete seed2['users/pres'];
    const env2 = makeEnv({ seed: seed2 });
    await assert.rejects(() => go(env2), /no president\/owner account would remain/);
    assert.deepEqual(env2.db.requested, []);
    assert.deepEqual(env2.io.writes, []);
    assert.deepEqual(env2.auth.requested, []);
    // the same plan as a DRY RUN only warns
    const env3 = makeEnv({ seed: seed2 });
    const r = await run(env3.deps, { log: env3.out.log });
    assert.equal(r.exitCode, 0);
    assert.match(text(env3), /SAFETY: no president\/owner account would remain/);
  });

  it('a staff account with a stale partner claim is left alone, listed under "needs a look" in the dry run, and the verification flags it (exit 2)', async () => {
    const auth = worldAuth().map((u) => (u.uid === 'emp2' ? Object.assign({}, u, { customClaims: { role: 'partner' } }) : u));
    const dry = makeEnv({ auth });
    await run(dry.deps, { log: dry.out.log, showUids: true });
    assert.match(text(dry), /Auth accounts whose claim says partner but whose profile does not: 1/);
    assert.match(text(dry), /needs a look \(Auth claim\): emp2/);
    const env = makeEnv({ auth });
    const r = await run(env.deps, { apply: true, backupDir: BK, log: env.out.log });
    assert.deepEqual(sorted(env.auth.requested), EXPECTED_AUTH_DELETES);          // emp2 was NOT deleted
    assert.ok(env.auth.store.has('emp2'));
    assert.ok(env.db.store.has('users/emp2'));
    assert.equal(r.exitCode, 2);
    assert.deepEqual(r.verification.failures.sort(), ['Auth accounts (any state) with claim role partner: 1', 'Auth accounts enabled with claim role partner: 1']);
  });

  it('a Brilliant-Steel-only non-partner account is counted and survives (owner Q3)', async () => {
    const env = makeEnv();
    await go(env);
    assert.match(text(env), /Brilliant-Steel-only accounts whose role is not partner \(Q3, reported only, NOT deleted\): 1/);
    assert.ok(env.db.store.has('users/bsx'));
    assert.ok(env.auth.store.has('bsx'));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('real files — the default file system writes, fsyncs and reads back', () => {
  const made = [];
  after(() => { made.forEach((d) => fs.rmSync(d, { recursive: true, force: true })); });

  it('run() with the real file system leaves a complete backup in a new directory, and writeBackup refuses to overwrite it', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pdp-real-'));
    made.push(root);
    const dir = path.join(root, 'nested', 'export');
    const env = makeEnv({ io: makeFileIo(fs) });
    const r = await run(env.deps, { backupDir: dir, log: env.out.log });
    assert.equal(r.exitCode, 0);
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    assert.equal(m.complete, true);
    for (const f of m.files) {
      const body = fs.readFileSync(path.join(dir, f.file), 'utf8');
      assert.equal(sha(body), f.sha256);
      assert.equal(JSON.parse(body).length, f.records);
    }
    assert.ok(fs.statSync(path.join(dir, 'users.json')).size > 10);
    await assert.rejects(() => run(makeEnv({ io: makeFileIo(fs) }).deps, { backupDir: dir, log: () => {} }), /already holds a manifest\.json/);
    assert.throws(() => writeBackup(makeFileIo(fs), dir, [], [], { createdAt: 'x', report: {} }), /already holds a manifest\.json/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('command line — nothing reaches Firebase on a typo or a missing backup', () => {
  it('parseArgs: a dry run unless --apply; --backup takes a directory; anything unrecognised is reported, not ignored', () => {
    const base = { apply: false, backupDir: null, backupMissing: false, showUids: false, help: false, unknown: [] };
    assert.deepEqual(parseArgs([]), base);
    assert.deepEqual(parseArgs(undefined), base);
    assert.deepEqual(parseArgs(['--apply']), Object.assign({}, base, { apply: true }));
    assert.deepEqual(parseArgs(['--backup', 'out/dir']), Object.assign({}, base, { backupDir: 'out/dir' }));
    assert.deepEqual(parseArgs(['--backup=out/dir', '--apply']), Object.assign({}, base, { backupDir: 'out/dir', apply: true }));
    assert.deepEqual(parseArgs(['--apply', '--backup', 'd', '--show-uids']), Object.assign({}, base, { apply: true, backupDir: 'd', showUids: true }));
    assert.deepEqual(parseArgs(['--help']), Object.assign({}, base, { help: true }));
    assert.deepEqual(parseArgs(['-h']), Object.assign({}, base, { help: true }));
    assert.deepEqual(parseArgs(['--aply']), Object.assign({}, base, { unknown: ['--aply'] }));
    assert.deepEqual(parseArgs(['--apply', '--nope', 'stray']), Object.assign({}, base, { apply: true, unknown: ['--nope', 'stray'] }));
    assert.equal(parseArgs(['--backup']).backupMissing, true);
    assert.equal(parseArgs(['--backup', '--apply']).backupMissing, true);
    assert.equal(parseArgs(['--backup', '--apply']).apply, true);
    assert.equal(parseArgs(['--backup=']).backupMissing, true);
    assert.equal(parseArgs(['--backup', '']).backupMissing, true);
  });

  // spawned WITHOUT FIREBASE_SERVICE_ACCOUNT: if the script reached its credential check it would exit 2 ("CONFIG ERROR"), not 0 / 1
  const cli = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  const made = [];
  after(() => { made.forEach((d) => fs.rmSync(d, { recursive: true, force: true })); });

  it('--help prints the usage and exits 0 without loading firebase or reading a credential', () => {
    const r = cli('--help');
    assert.equal(r.status, 0);
    assert.match(r.stdout, /--apply/);
    assert.match(r.stdout, /--backup <dir>/);
    assert.match(r.stdout, /DRY RUN/);
    assert.ok(!/CONFIG ERROR/.test(r.stderr));
  });

  it('--apply WITHOUT --backup exits 1 with the "needs --backup" message, before any credential is read', () => {
    const r = cli('--apply');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--apply needs --backup/);
    assert.match(r.stderr, /no credential was read/);
    assert.ok(!/CONFIG ERROR/.test(r.stderr), 'the credential check ran before the arguments were validated');
    assert.equal(r.stdout, '');
    const r2 = cli('--apply', '--show-uids');
    assert.equal(r2.status, 1);
    assert.match(r2.stderr, /--apply needs --backup/);
  });

  it('an unknown option, a --backup with no directory, or a stray argument exits 1 before anything else runs', () => {
    for (const args of [['--aply'], ['--backup'], ['--apply', '--backup'], ['--backup='], ['stray'], ['--apply', '--nope']]) {
      const r = cli(...args);
      assert.equal(r.status, 1, args.join(' '));
      assert.match(r.stderr, /Nothing was run/, args.join(' '));
      assert.ok(!/CONFIG ERROR/.test(r.stderr), args.join(' ') + ': the credential check ran first');
    }
    assert.match(cli('--aply').stderr, /--aply/);
    assert.match(cli('--backup').stderr, /--backup needs a directory/);
  });

  it('a backup directory inside the repository exits 1 before any credential is read, and is not created', () => {
    const dir = path.join(REPO, 'zz-purge-backup-test-dir');
    for (const args of [['--backup', dir], ['--apply', '--backup', dir], ['--backup=' + dir]]) {
      const r = cli(...args);
      assert.equal(r.status, 1, args.join(' '));
      assert.match(r.stderr, /is inside this repository/);
      assert.match(r.stderr, /Nothing was run/);
      assert.ok(!/CONFIG ERROR/.test(r.stderr));
    }
    assert.ok(!fs.existsSync(dir));
  });

  it('a backup directory that already holds a manifest.json exits 1 before any credential is read', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pdp-cli-'));
    made.push(d);
    fs.writeFileSync(path.join(d, 'manifest.json'), '{}');
    for (const args of [['--backup', d], ['--apply', '--backup', d]]) {
      const r = cli(...args);
      assert.equal(r.status, 1, args.join(' '));
      assert.match(r.stderr, /already holds a manifest\.json/);
      assert.ok(!/CONFIG ERROR/.test(r.stderr));
    }
  });

  it('with valid arguments it goes on to the credential check (exit 2, CONFIG ERROR) and creates no directory first', { skip: !fs.existsSync(path.resolve(__dirname, '..', 'scripts', 'node_modules', 'firebase-admin')) }, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pdp-cli-'));
    made.push(root);
    const dir = path.join(root, 'fresh');
    for (const args of [[], ['--show-uids'], ['--backup', dir], ['--apply', '--backup', dir]]) {
      const r = cli(...args);
      assert.equal(r.status, 2, 'valid arguments must reach the credential check: ' + args.join(' '));
      assert.match(r.stderr, /FIREBASE_SERVICE_ACCOUNT/);
    }
    assert.ok(!fs.existsSync(dir), 'the argument phase must not create the backup directory');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('the script itself', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).map((l) => l.replace(/\s\/\/.*$/, '')).join('\n');

  it('only ever DELETES, plus one group-chat edit: no other document write, no Auth write or claim change appears in the executable code', () => {
    const noHash = code.replace(/createHash\('sha256'\)\.update\(/g, 'createHash(\'sha256\').digestOf(');   // the one legitimate .update( is crypto's
    // the ONE write that is not a delete: the group-chat edit, a batch.update whose patch comes from buildGroupPatch
    assert.equal((noHash.match(/batch\.update\(/g) || []).length, 1, 'exactly one update call is allowed');
    assert.ok(noHash.indexOf("batch.update(db.doc(pathFor('conversations', p.id)), p.patch)") > 0, 'the update is not the group-chat edit');
    assert.ok(noHash.indexOf('patch: buildGroupPatch(e, FV)') > 0);
    const rest = noHash.replace(/batch\.update\(/g, 'batch.UPD(');
    for (const re of [/\.set\(/, /\.update\(/, /\.create\(/, /setCustomUserClaims/, /updateUser\(/, /createUser\(/, /\.add\(\{/, /\.runTransaction/, /merge:/]) {
      assert.ok(!re.test(rest), 'executable code matches ' + re);
    }
    assert.ok(/batch\.delete\(/.test(code) && /auth\.deleteUser\(/.test(code));
  });

  it('never names a password hash or salt in code (they can only be left behind, never exported)', () => {
    assert.ok(!/passwordHash|passwordSalt/.test(code));
  });

  it('no credential is read at module load: FIREBASE_SERVICE_ACCOUNT is only touched inside main, after the argument checks', () => {
    const at = code.indexOf("requireEnv('FIREBASE_SERVICE_ACCOUNT')");
    assert.ok(at > 0);
    assert.ok(code.indexOf('async function main') > 0 && at > code.indexOf('async function main'));
    for (const guard of ['--apply needs --backup', 'Unknown option(s)', 'The backup directory already holds a manifest.json']) {
      assert.ok(code.indexOf(guard) > 0 && code.indexOf(guard) < at, guard + ' must come before the credential read');
    }
    assert.ok(code.indexOf("require('firebase-admin')") > code.indexOf('async function main'));
    // what main hands to run() cannot be exercised without credentials, so pin it: the parsed flags go through, the directory is resolved
    assert.ok(code.indexOf('{ apply: args.apply, backupDir: dir, showUids: args.showUids, projectId: serviceAccount.project_id }') > 0);
    assert.ok(code.indexOf('{ db: admin.firestore(), auth: admin.auth(), FieldValue: admin.firestore.FieldValue }') > 0);
    assert.ok(code.indexOf('const dir = args.backupDir ? nodePath.resolve(args.backupDir) : null;') > 0);
    assert.ok(code.indexOf('return result.exitCode;') > 0);
  });
});
