// functions/staff-core.js — STAFF ACCOUNT CREATION (STATUS.md Open ruling #13).
//
// Pure, zero-Firebase-dependency helpers for the createStaffAccount callable
// in index.js. CommonJS, no firebase-admin / firebase-functions, so
// tests/staff-account.test.mjs require()s it directly (no emulator).
//
// WHY THIS EXISTS
// Staff and worker accounts used to be minted in the BROWSER with
// createUserWithEmailAndPassword on a secondary Firebase app (Invite Team
// Member, js/screens/people.js; Create Worker Account, js/screens/dashboards.js).
// That needs Firebase Auth email/password SIGN-UP enabled, and the web apiKey
// is public — so anyone could mint an Auth account and then self-create
// users/{uid} as an 'employee' through the isOwner(uid) branch of the users
// create rule, reading every employee-tier collection. Account creation now
// runs here, with the Admin SDK; the rule branch is gone and sign-up can be
// switched OFF in the console.
//
// THE AUTHORIZATION MATRIX mirrors the admin branches of the `users` create
// rule in firestore.rules exactly (who may mint which role, which departments
// are frozen) — the rule stays the boundary for direct writes, this is the
// boundary for the callable, and the two must never drift. The caller's role
// and flags are read server-side from the caller's OWN users doc; nothing the
// client sends about itself is trusted.
'use strict';

const KNOWN_ROLES = ['president', 'manager', 'secretary', 'employee', 'agent', 'finance'];
// isSeniorAdmin() (manager) branch of the create rule.
const SENIOR_MINTABLE_ROLES = ['manager', 'secretary', 'employee', 'agent', 'finance'];
// isAdmin() (secretary) and isAccountAdminFlag() branches of the create rule.
const BASIC_MINTABLE_ROLES = ['employee', 'agent'];
// noPrivilegedDeptOnCreate() in firestore.rules — keep identical.
const PRIVILEGED_DEPTS = ['Finance', 'Design', 'Ventures', 'IT'];

const WORKER_EMAIL_DOMAIN = 'bi.barroindustries';
const USERNAME_RE = /^[a-z0-9_]{2,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function str(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/**
 * Validates and normalises the client payload. Returns { error } or { req }.
 * Unknown keys are dropped — nothing is ever spread onto the users doc.
 */
function parseStaffRequest(data) {
  const d = (data && typeof data === 'object') ? data : {};
  const kind = d.kind;
  if (kind !== 'invite' && kind !== 'worker') return { error: 'kind must be "invite" or "worker".' };

  const role = str(d.role, 20);
  if (!KNOWN_ROLES.includes(role)) return { error: 'Unknown role.' };

  const rawDepts = Array.isArray(d.departments) ? d.departments : [];
  if (rawDepts.length > 20) return { error: 'Too many departments.' };
  const departments = [];
  for (const x of rawDepts) {
    const v = str(x, 40);
    if (!v) return { error: 'Invalid department.' };
    if (!departments.includes(v)) departments.push(v);
  }

  const displayName = str(d.displayName, 120);
  const req = { kind, role, departments, displayName };

  if (kind === 'invite') {
    const email = str(d.email, 254).toLowerCase();
    if (!EMAIL_RE.test(email)) return { error: 'A valid email is required.' };
    if (email.endsWith('@' + WORKER_EMAIL_DOMAIN)) return { error: 'That address is reserved for worker logins.' };
    req.email = email;
    req.phone = str(d.phone, 40);
    req.freelancer = d.freelancer === true;
    // '__freelancer' is a TEAM classification, not a permission role (people.js).
    if (req.freelancer && role !== 'employee') return { error: 'A freelancer is created as an employee.' };
    return { req };
  }

  // worker
  const username = str(d.username, 40).toLowerCase();
  if (!USERNAME_RE.test(username)) return { error: 'Username must be 2–32 lowercase letters, digits or underscores.' };
  const password = typeof d.password === 'string' ? d.password : '';
  if (password.length < 6 || password.length > 128) return { error: 'Password must be 6–128 characters.' };
  if (!displayName) return { error: 'Full name is required.' };
  if (departments.length > 1) return { error: 'A worker account has one primary department.' };
  const startDate = str(d.startDate, 10);
  if (startDate && !DATE_RE.test(startDate)) return { error: 'startDate must be YYYY-MM-DD.' };
  Object.assign(req, {
    username, password, startDate,
    email: `${username}@${WORKER_EMAIL_DOMAIN}`,
    employeeId: str(d.employeeId, 40),
    title: str(d.title, 120),
    employmentStatus: str(d.employmentStatus, 40),
    payClass: d.payClass === 'production' ? 'production' : 'regular'
  });
  return { req };
}

/**
 * Returns null when `caller` (the caller's own users doc data, or null) may
 * mint `req`, else a human-readable reason. Union of the create rule's admin
 * branches: a caller qualifying for several gets the widest.
 */
function authorizeStaffCreate(caller, req) {
  if (!caller) return 'Your account has no profile.';
  if (caller.removed === true) return 'Your account is offboarded.';
  const role = caller.role;
  const privileged = req.departments.some(d => PRIVILEGED_DEPTS.includes(d));

  if (role === 'president') return null;
  if (role === 'manager' && SENIOR_MINTABLE_ROLES.includes(req.role)) return null;
  const basic = role === 'secretary' || caller.accountAdmin === true;
  if (basic && BASIC_MINTABLE_ROLES.includes(req.role) && !privileged) return null;

  if (role === 'manager' || basic) {
    return privileged && BASIC_MINTABLE_ROLES.includes(req.role)
      ? 'Only the President or a Manager can create accounts in Finance, Design, Ventures or IT.'
      : `You cannot create a '${req.role}' account.`;
  }
  return 'Not authorized to create accounts.';
}

/** The new users/{uid} doc — an explicit field list, never a spread. */
function buildStaffUserDoc(req, uid, callerUid, employeeId, today, FieldValue) {
  const base = {
    uid,
    email: req.email,
    role: req.role,
    departments: req.departments,
    department: req.departments[0] || '',
    employeeId: employeeId || '',
    photoUrl: '',
    createdBy: callerUid,
    createdVia: req.kind === 'worker' ? 'create-worker-account' : 'invite',
    createdAt: FieldValue.serverTimestamp()
  };
  if (req.kind === 'invite') {
    return Object.assign(base, {
      displayName: req.displayName || req.email.split('@')[0],
      phone: req.phone,
      startDate: today,
      // TEAM-PAGE-ORG-SPEC 2026-08-25 §2e — stamp the Team-page type at creation.
      team: req.freelancer ? 'freelancer' : req.role === 'agent' ? 'agent' : 'office'
    }, req.freelancer ? { employmentType: 'Project-based' } : {});
  }
  return Object.assign(base, {
    displayName: req.displayName,
    username: req.username,
    authEmail: req.email,
    title: req.title,
    startDate: req.startDate || today,
    employmentStatus: req.employmentStatus,
    hrManagedAccount: true,
    team: req.payClass === 'production' ? 'operations' : 'office'
  });
}

/** Same claim shape syncUserClaims mints: { role, departments }. */
function claimsFor(userDoc) {
  return { role: userDoc.role, departments: userDoc.departments.slice() };
}

module.exports = {
  KNOWN_ROLES, SENIOR_MINTABLE_ROLES, BASIC_MINTABLE_ROLES, PRIVILEGED_DEPTS, WORKER_EMAIL_DOMAIN,
  parseStaffRequest, authorizeStaffCreate, buildStaffUserDoc, claimsFor
};
