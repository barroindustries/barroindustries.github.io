// tests/fixtures/sales-flow-harness.mjs — shared by tests/sales-flow-screens.test.mjs and tests/sales-flow-quotes.test.mjs.
//
// A fake world for running the REAL screen code of js/departments.js and js/screens/sales.js inside a vm: an in-memory
// Firestore (collections, == queries, set/update/add/delete, arrayUnion, server timestamps), a fake panel that finds ids
// in the HTML openPage was given, recorded toasts / notifications / audit rows, Ledger.post with the real contract
// (deterministic id, dedupe, projectSync in the same call), BankAccounts and Drive's uploader. makeBaseEnv() loads the
// REAL js/money-core.js and js/sales-flow-core.js; the caller loads the screen code it wants to exercise (env.load).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
// Objects built inside the vm come from another realm, so strict deepEqual would reject them on prototype alone: compare as JSON.
export const same = (a, b, m) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null)), m);
// The text of `src` from the first `from` to the next `to` (both must exist).
export function sliceOf(src, from, to) {
  const a = src.indexOf(from);
  assert.ok(a >= 0, `marker not found: ${from.slice(0, 60)}`);
  const b = to ? src.indexOf(to, a) : src.length;
  assert.ok(b > a, `end marker not found: ${String(to).slice(0, 60)}`);
  return src.slice(a, b);
}
// The keys firestore.rules lets a Sales user (creator or Sales dept) write on a sales order, parsed from the REAL rules file: soPayKeys() +
// soHandoffKeys() + the literal list concatenated in soSalesUpdate(). Tests compare what the screen code writes against THIS, so the code and
// the rules cannot drift apart without a test failing.
export function salesAllowedKeys() {
  const rules = read('firestore.rules').replace(/\/\/[^\n]*/g, '');
  const body = (head) => { const a = rules.indexOf(head); const o = rules.indexOf('{', a + head.length); let d = 0; for (let i = o; i < rules.length; i++) { if (rules[i] === '{') d++; else if (rules[i] === '}' && --d === 0) return rules.slice(o, i + 1); } throw new Error('unbalanced ' + head); };
  const keys = (t) => [...t.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]);
  const sales = body('function soSalesUpdate()');
  const hasOnly = sales.slice(sales.indexOf('.hasOnly('));
  return new Set([...keys(body('function soPayKeys()')), ...keys(body('function soHandoffKeys()')), ...keys(hasOnly.slice(0, hasOnly.indexOf('&&')))]);
}
const MONEY = read('js/money-core.js');
const CORE = read('js/sales-flow-core.js');

// ── a tiny Firestore ───────────────────────────────────────────────────────────────────────────────────────────
export const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const isOp = (v) => v && typeof v === 'object' && v.__op;
class Snap { constructor(id, data) { this.id = id; this.exists = data !== undefined; this._d = data; } data() { return this._d === undefined ? undefined : clone(this._d); } }
export function makeDb(seed = {}) {
  const store = {};
  const log = [];
  let tick = 1000, auto = 0;
  for (const [c, docs] of Object.entries(seed)) { store[c] = new Map(Object.entries(docs).map(([id, d]) => [id, clone(d)])); }
  const col = (c) => (store[c] || (store[c] = new Map()));
  const stamp = () => { const n = ++tick; return { seconds: n, toDate: () => new Date(n * 1000) }; };
  const resolve = (v) => (isOp(v) && v.__op === 'ts' ? stamp() : v);
  const apply = (existing, patch) => {
    const out = { ...(existing || {}) };
    for (const [k, v] of Object.entries(patch)) {
      if (isOp(v) && v.__op === 'union') { const cur = Array.isArray(out[k]) ? out[k].slice() : []; if (!cur.some((x) => JSON.stringify(x) === JSON.stringify(v.v))) cur.push(clone(v.v)); out[k] = cur; }
      else if (isOp(v) && v.__op === 'ts') out[k] = stamp();
      else if (isOp(v) && v.__op === 'delete') delete out[k];
      else out[k] = clone(v);
    }
    return out;
  };
  const query = (c, filters = []) => ({
    where(f, op, val) { assert.equal(op, '==', 'the fake supports == only'); return query(c, filters.concat([[f, val]])); },
    orderBy() { return query(c, filters); },
    limit() { return query(c, filters); },
    async get() {
      log.push({ op: 'query', path: c, filters });
      const docs = [...col(c).entries()].filter(([, d]) => filters.every(([f, val]) => d[f] === val)).map(([id, d]) => { const s = new Snap(id, d); s.ref = { id }; return s; });
      return { docs, size: docs.length, empty: !docs.length };
    },
  });
  const db = {
    store, log,
    collection(c) {
      return {
        doc: (id) => ({
          id,
          async get() { return new Snap(id, col(c).get(id)); },
          async set(data, opts) { log.push({ op: 'set', path: `${c}/${id}`, data }); col(c).set(id, opts && opts.merge ? apply(col(c).get(id), data) : apply({}, data)); },
          async update(patch) { if (!col(c).has(id)) throw Object.assign(new Error('not-found: ' + c + '/' + id), { code: 'not-found' }); log.push({ op: 'update', path: `${c}/${id}`, patch }); col(c).set(id, apply(col(c).get(id), patch)); },
          async delete() { log.push({ op: 'delete', path: `${c}/${id}` }); col(c).delete(id); },
        }),
        async add(data) { const id = `${c}_${++auto}`; log.push({ op: 'add', path: `${c}/${id}`, data }); col(c).set(id, apply({}, data)); return { id }; },
        where: (...a) => query(c).where(...a), orderBy: () => query(c), limit: () => query(c), get: () => query(c).get(),
      };
    },
    writes(prefix) { return log.filter((l) => l.op !== 'query' && l.path.startsWith(prefix)); },
  };
  return db;
}

// ── a fake panel (what openPage returns) ───────────────────────────────────────────────────────────────────────
const unesc = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
function makeEl(id, tag, attrs) {
  const el = {
    id, tag, dataset: {}, disabled: false, textContent: '', innerHTML: '', _h: {}, _cls: new Set((/\bclass="([^"]*)"/.exec(attrs) || [, ''])[1].split(/\s+/).filter(Boolean)),
    value: (/\bvalue="([^"]*)"/.exec(attrs) || [, ''])[1] === undefined ? '' : unesc((/\bvalue="([^"]*)"/.exec(attrs) || [, ''])[1]),
    classList: null,
    addEventListener(t, fn) { (el._h[t] || (el._h[t] = [])).push(fn); },
    async click() { const e = { currentTarget: el, target: el }; return Promise.all((el._h.click || []).map((fn) => fn(e))); },
    async fire(t) { return Promise.all((el._h[t] || []).map((fn) => fn({ currentTarget: el, target: el }))); },
  };
  el.classList = { add: (c) => el._cls.add(c), remove: (c) => el._cls.delete(c), contains: (c) => el._cls.has(c), toggle: (c, on) => (on === undefined ? (el._cls.has(c) ? el._cls.delete(c) : el._cls.add(c)) : on ? el._cls.add(c) : el._cls.delete(c)) };
  return el;
}
export function makePanel(title, html, opts) {
  const els = {}, radios = [];
  const tagRe = /<(input|select|textarea|button|div|span|a|label)\b([^>]*)>/g;
  let m;
  while ((m = tagRe.exec(html))) {
    const [, tag, attrs] = m;
    const idm = /\bid="([^"]+)"/.exec(attrs);
    if (tag === 'input' && /type="radio"/.test(attrs)) {
      const name = (/\bname="([^"]+)"/.exec(attrs) || [])[1], value = (/\bvalue="([^"]*)"/.exec(attrs) || [])[1];
      const r = makeEl(idm ? idm[1] : `radio-${name}-${value}`, 'radio', attrs); r.name = name; r.value = value; r.checked = false; radios.push(r); continue;
    }
    if (!idm) continue;
    const el = makeEl(idm[1], tag, attrs);
    const after = html.slice(m.index + m[0].length);
    if (tag === 'select') {
      const body = after.slice(0, after.indexOf('</select>'));
      const opts2 = [...body.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)].map((o) => ({ value: unesc((/\bvalue="([^"]*)"/.exec(o[1]) || [, o[2].replace(/<[^>]*>/g, '').trim()])[1]), selected: /\bselected\b/.test(o[1]) }));
      const pick = opts2.find((o) => o.selected) || opts2[0];
      el.value = pick ? pick.value : '';
    }
    if (tag === 'textarea') el.value = unesc(after.slice(0, after.indexOf('</textarea>')));
    els[idm[1]] = el;
  }
  const panel = {
    title, opts, html, els, radios,
    querySelector(sel) {
      let mm;
      if ((mm = /^#([\w-]+)$/.exec(sel))) return els[mm[1]] || null;
      if ((mm = /^input\[name="([\w-]+)"\]:checked$/.exec(sel))) return radios.find((r) => r.name === mm[1] && r.checked) || null;
      return null;
    },
    querySelectorAll(sel) {
      const mm = /^input\[name="([\w-]+)"\]$/.exec(sel);
      return mm ? radios.filter((r) => r.name === mm[1]) : [];
    },
    async check(name, value) { for (const r of radios.filter((x) => x.name === name)) r.checked = r.value === value; for (const r of radios.filter((x) => x.name === name && x.checked)) await r.fire('change'); },
    $(id) { return els[id]; },
  };
  return panel;
}

// ── the environment ────────────────────────────────────────────────────────────────────────────────────────────
export const PRES = { role: 'president', depts: [], uid: 'u-pres', name: 'Neil Barro' };
export const SALES = { role: 'employee', depts: ['Sales'], uid: 'u-sales', name: 'Uriel' };
export const FIN = { role: 'finance', depts: ['Finance'], uid: 'u-fin', name: 'Shaira' };
export const MGR = { role: 'manager', depts: [], uid: 'u-mgr', name: 'Manager' };
export const PROD = { role: 'employee', depts: ['Production'], uid: 'u-prod', name: 'Rene' };

export function makeBaseEnv(who = PRES, { seed = {}, banks = [], forms = null, confirmAnswer = true, promptAnswer = 'amount does not match the receipt' } = {}) {
  const db = makeDb(seed);
  const env = { db, toasts: [], notifs: [], audits: [], pages: [], closes: 0, dialogs: [], prompts: [], invalidated: [], uploads: {}, ensured: [], jobProjectArgs: [], rerenders: [], tracking: [], confirmAnswer, promptAnswer, forms, who };
  const ctx = vm.createContext({ console, setTimeout, clearTimeout, URL, Promise, Date, JSON, Math, Number, String, Array, Object, parseFloat, parseInt, isNaN, Set, Map });
  ctx.window = ctx;
  Object.assign(ctx, { currentRole: who.role, currentDepts: who.depts, currentUser: { uid: who.uid, email: who.name.toLowerCase() + '@x.test' }, userProfile: { displayName: who.name } });
  ctx.SECRETARY_BLOCKED_DEPTS = ['Finance', 'IT'];
  ctx.firebase = { firestore: { FieldValue: { serverTimestamp: () => ({ __op: 'ts' }), arrayUnion: (v) => ({ __op: 'union', v }), delete: () => ({ __op: 'delete' }) } } };
  ctx.db = db;
  ctx.escHtml = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  ctx.safeHttpUrl = (u) => (/^https?:\/\//.test(String(u)) ? String(u) : '');
  ctx.emojiIcon = (g) => `<i class="emo">${g}</i>`;
  ctx.fmtN2 = (n) => Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  ctx.fmt = (n) => ctx.fmtN2(n);
  ctx.today = () => '2026-11-19';
  ctx.bizDate = () => '2026-11-19';
  ctx.skeletonHtml = () => '<skeleton></skeleton>';
  ctx.isRealPresident = () => ctx.window.currentRole === 'president';
  ctx.dbCachedGet = async (key, fetcher) => fetcher();
  ctx.dbCacheInvalidate = (k) => env.invalidated.push(k);
  ctx.busy = async (btn, fn) => fn();
  ctx.confirmDialog = async (o) => { env.dialogs.push(o); return env.confirmAnswer; };
  ctx.promptDialog = async (o) => { env.prompts.push(o); return env.promptAnswer; };
  ctx.closeModal = () => { env.closes++; };
  ctx.openPage = (title, body, footer, opts) => { const p = makePanel(title, (body || '') + (footer || ''), opts); env.pages.push(p); return p; };
  ctx.Notifs = {
    showToast: (msg, type) => env.toasts.push({ msg, type: type || 'info' }),
    success: (msg) => env.toasts.push({ msg, type: 'success' }),
    send: async (to, p) => { env.notifs.push({ kind: 'send', to, ...p }); },
    sendToOwner: async (p) => { env.notifs.push({ kind: 'owner', ...p }); },
    sendToDept: async (dept, p, o) => { env.notifs.push({ kind: 'dept', dept, opts: o || null, ...p }); },
  };
  ctx.safeNotify = async (fn) => { try { await fn(); } catch (_) {} };
  ctx.logAudit = (...a) => env.audits.push(a);
  ctx.localStorage = (() => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; })();
  ctx.Drive = { renderUploadArea: (id, cb, o) => { env.uploads[id] = { cb, opts: o }; } };
  ctx.ensureScript = (src) => { env.ensured.push(src); if (src === 'js/forms.js') { if (!env.forms) return Promise.reject(new Error('404')); ctx.Forms = env.forms; } return Promise.resolve(); };
  ctx.syncOrderTracking = async (token, patch) => { env.tracking.push({ token, patch }); };
  ctx.quoteCollectionFor = (co) => (co === 'BS' ? 'bs_quotes' : 'bk_quotes');
  ctx.isInternalQuoteCompany = (co) => co !== 'BS';
  ctx.quoteCompanyLabel = (co) => co;
  ctx.invalidateBsQuotesCache = () => {};
  ctx.Clients = { findByName: async () => null };
  ctx.uniqueTrackCode = async () => 'TRK12345';
  ctx.orderTrackUrl = (t) => 'https://x.test/t/?' + t;
  ctx.showOrderTrackModal = () => {};
  ctx.renderBKQuotationsSummary = (...a) => env.rerenders.push(['bk', ...a.slice(0, 1).map(() => 'c')]);
  ctx.renderBSQuotationsSummary = (...a) => env.rerenders.push(['bs']);
  ctx.openRecordSaleModal = () => {};
  ctx.openJobProjectDetail = () => {};
  ctx.jobDesignApproved = () => false;
  ctx.DesignFolders = { ensureProjectFolder: async () => {} };
  ctx.createJobProject = async (d) => {
    env.jobProjectArgs.push(d);
    const r = await db.collection('job_projects').add({ projectNo: 'JP-2611-001', stage: 'won', quoteId: d.id, clientName: d.client, contractAmount: d.total, amountCollected: 0, arBalance: d.total, flowVersion: d.flowVersion || null, items: d.items, documents: [{ type: 'Quotation', ref: d.qno }], timeline: [], payments: [] });
    return { id: r.id, projectNo: 'JP-2611-001' };
  };
  ctx.Ledger = {
    _sanitize: (r) => String(r == null ? '' : r).replace(/\//g, '_'),
    post: async (entry) => {
      const id = ctx.Ledger._sanitize(entry.ref);
      if (db.store.ledger && db.store.ledger.has(id)) return { existed: true, id };
      await db.collection('ledger').doc(id).set({ refNumber: entry.ref, amount: entry.amount, type: entry.kind, source: entry.source, date: entry.date, projectId: entry.projectId, ...(entry.extra || {}) });
      if (entry.projectSync) await db.collection(entry.projectSync.collection).doc(entry.projectSync.docId).update(entry.projectSync.fields);
      return { existed: false, id };
    },
  };
  ctx.BankAccounts = {
    list: async () => banks,
    optionsHTML: async (sel) => '<option value="">— no account —</option>' + banks.map((b) => `<option value="${b.id}" ${b.id === sel ? 'selected' : ''}>${b.nickname}</option>`).join(''),
    pick: async (id) => (id ? { bankAccountId: id, bankAccountName: 'Bank ' + id } : { bankAccountId: null, bankAccountName: null }),
    tag: (a, flow) => (a && a.bankAccountId ? { bankAccountId: a.bankAccountId, bankAccountName: a.bankAccountName || null, bankFlow: flow } : {}),
  };
  vm.runInContext(MONEY, ctx, { filename: 'js/money-core.js' });
  vm.runInContext(CORE, ctx, { filename: 'js/sales-flow-core.js' });
  env.ctx = ctx;
  env.load = (code, filename) => vm.runInContext(code, ctx, { filename });
  env.lastPage = () => env.pages[env.pages.length - 1];
  env.toastMsgs = () => env.toasts.map((t) => t.msg);
  return env;
}

