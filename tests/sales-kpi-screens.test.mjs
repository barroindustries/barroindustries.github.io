// tests/sales-kpi-screens.test.mjs — the Sales Manager KPI SCREENS, run for real (SALES-MANAGER-KPI-SPEC-2026-11-20, rollout steps 3, 4 and 5).
//
// tests/sales-kpi-core.test.mjs pins the pure rules. This file runs the REAL js/screens/sales-kpi.js inside a vm — with the real js/sales-kpi-core.js — against the
// shared in-memory Firestore of tests/fixtures/sales-flow-harness.mjs and a small fake DOM (nested hosts, #id and .class lookups, events):
//   step 3  the President's Sales KPI card: who it is for, on/off, start month, a BLANK default target, single-month targets, the fixed 70/30 weights; what it writes;
//   step 4  the President's "Client rating" on a delivered-or-later job (stars, note, how he heard it) and the "Jobs waiting for a rating" list; what it writes;
//   step 5  the scorecard preview ("Preview — not yet used for pay"): Uriel's "My scorecard" on his Sales home and the same card for the President / Finance;
// plus textual pins that the hooks are wired where the build report says, that the screens only ever WRITE sales_kpi and client_ratings (display only: nothing reaches
// payroll), and that no target figure lives in a tracked file (the owner's default target is typed into the card by the President; the repo is public).
//
// Every figure below is a made-up round number. Run with: node --test tests/*.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PRES, SALES, FIN, PROD, MGR, makeBaseEnv, read, same } from './fixtures/sales-flow-harness.mjs';

const CORE = read('js/sales-kpi-core.js');
const SCREEN = read('js/screens/sales-kpi.js');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ── a small fake DOM ─────────────────────────────────────────────────────────────────────────────────────────────
// Elements are created by assigning innerHTML to a host (every opening tag becomes one). A host's descendants are the elements created by its own innerHTML and,
// transitively, by the innerHTML of the hosts inside it; reassigning innerHTML detaches them. Supports #id and .class lookups, events, value / checked / selected.
const unesc = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
function makeDom() {
  const all = [];
  const VOID = new Set(['input', 'br', 'img', 'hr', 'meta', 'link']);
  // the markup between an opening tag and its matching close (same tag name, nesting counted)
  function innerOf(html, at, tag) {
    if (VOID.has(tag)) return '';
    const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
    re.lastIndex = at;
    let depth = 1, m;
    while ((m = re.exec(html))) {
      depth += m[1] ? -1 : 1;
      if (depth === 0) return html.slice(at, m.index);
    }
    return html.slice(at);
  }
  function El(tag, attrs, owner, html, at) {
    this.tag = tag; this.owner = owner; this._h = {}; this.style = {}; this._own = html === '' ? '' : innerOf(html, at, tag); this._assigned = false; this.isConnected = true; this._attrs = {};
    for (const m of attrs.matchAll(/([\w:-]+)(?:="([^"]*)"|='([^']*)')?/g)) this._attrs[m[1]] = m[2] !== undefined ? unesc(m[2]) : m[3] !== undefined ? unesc(m[3]) : '';
    this.id = this._attrs.id || '';
    this._cls = new Set((this._attrs.class || '').split(/\s+/).filter(Boolean));
    this.dataset = {};
    for (const [k, v] of Object.entries(this._attrs)) if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = v;
    this.disabled = 'disabled' in this._attrs;
    this.checked = 'checked' in this._attrs;
    this.value = this._attrs.value !== undefined ? this._attrs.value : '';
    const after = html.slice(at);
    if (tag === 'select') {
      const body = after.slice(0, after.indexOf('</select>'));
      const opts = [...body.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)].map((o) => ({ value: unesc((/\bvalue="([^"]*)"/.exec(o[1]) || [, o[2].replace(/<[^>]*>/g, '').trim()])[1]), selected: /\bselected\b/.test(o[1]) }));
      const pick = opts.find((o) => o.selected) || opts[0];
      this.value = pick ? pick.value : '';
    }
    if (tag === 'textarea') this.value = unesc(after.slice(0, after.indexOf('</textarea>')));
    const self = this;
    this.classList = { add: (c) => self._cls.add(c), remove: (c) => self._cls.delete(c), contains: (c) => self._cls.has(c), toggle: (c) => (self._cls.has(c) ? self._cls.delete(c) : self._cls.add(c)) };
  }
  El.prototype = {
    // what a browser would serialise: this element's markup and, appended, whatever the hosts inside it were given since (a close-enough concatenation)
    get innerHTML() { return this._assigned ? [this._own, ...all.filter((e) => e.isConnected && e !== this && this.contains(e) && e._assigned).map((e) => e._own)].join('') : this._own; },
    set innerHTML(v) { dom.detachChildren(this); this._own = String(v); this._assigned = true; this._text = undefined; dom.parse(this._own, this); },
    get textContent() { return this._text !== undefined ? this._text : plain(this.innerHTML); },
    set textContent(v) { this._text = String(v); },
    addEventListener(t, fn) { (this._h[t] || (this._h[t] = [])).push(fn); },
    async click() { if (this.disabled) return; return this.fire('click'); },
    async fire(t) { const e = { currentTarget: this, target: this, preventDefault() {}, stopPropagation() {} }; return Promise.all((this._h[t] || []).map((fn) => fn(e))); },
    setAttribute(k, v) { this._attrs[k] = String(v); }, getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; },
    contains(el) { for (let o = el; o; o = o.owner) if (o === this) return true; return false; },
    _matches(sel) { return sel.startsWith('#') ? this.id === sel.slice(1) : sel.startsWith('.') ? this._cls.has(sel.slice(1)) : this.tag === sel; },
    querySelector(sel) { return all.find((e) => e.isConnected && e !== this && this.contains(e) && e._matches(sel)) || null; },
    querySelectorAll(sel) { return all.filter((e) => e.isConnected && e !== this && this.contains(e) && e._matches(sel)); },
    focus() {},
  };
  const dom = {
    all,
    host(attrs = '') { const e = new El('div', attrs, null, '', 0); all.push(e); return e; },
    detachChildren(host) { for (const e of all) if (e !== host && host.contains(e)) e.isConnected = false; },
    parse(html, owner) {
      for (const m of html.matchAll(/<([a-zA-Z][\w-]*)\b([^>]*?)\/?>/g)) {
        const tag = m[1].toLowerCase();
        if (tag === 'option' || tag === 'svg' || tag === 'path') continue;
        all.push(new El(tag, m[2], owner, html, m.index + m[0].length));
      }
    },
  };
  return dom;
}
// Visible text of some markup: tags dropped, entities decoded, spaces collapsed.
const plain = (html) => unesc(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

// ── the world ──────────────────────────────────────────────────────────────────────────────────────────────────────
const sec = (iso) => ({ seconds: Math.floor(Date.parse(iso) / 1000), nanoseconds: 0 });
const stamp = (over = {}) => ({ decision: 'confirmed', decidedBy: 'u-pres', decidedByName: 'Neil Barro', decidedByRole: 'president', decidedAt: '2026-11-10T02:00:00.000Z', onBehalf: false, ...over });
const baseSeed = () => ({
  users: {
    'u-pres': { displayName: 'Neil Barro', role: 'president' },
    'u-fin': { displayName: 'Shaira Finance', role: 'finance', departments: ['Finance'] },
    'u-sales': { displayName: 'Uriel Sales', role: 'employee', departments: ['Sales'], title: 'Sales Manager' },
    'u-prod': { displayName: 'Rene Production', role: 'employee', departments: ['Production'] },
    'u-gone': { displayName: 'Old Timer', role: 'employee', removed: true },
    'u-worker': { displayName: 'Shop Worker', role: 'employee', hrManagedAccount: true },
  },
  sales_orders: {
    o1: { flowVersion: 2, status: 'recorded', company: 'BK', clientName: 'Acme Foods', quoteNumber: 'BK-1', createdBy: 'u-sales', recordedAmount: 25000, recordedAt: sec('2026-11-10T02:00:00.000Z'), paymentConfirm: stamp() },
    o2: { flowVersion: 2, status: 'recorded', company: 'BS', clientName: 'Steel Client', quoteNumber: 'BS-1', createdBy: 'u-sales', recordedAmount: 99000, recordedAt: sec('2026-11-11T02:00:00.000Z'), paymentConfirm: stamp() },
    o3: { flowVersion: 2, status: 'pending', company: 'BK', clientName: 'Waiting Co', createdBy: 'u-sales', paymentConfirm: { decision: null } },
  },
  payment_claims: {
    c1: { kind: 'balance', status: 'recorded', company: 'BK', clientName: 'Acme Foods', orderId: 'o1', createdBy: 'u-sales', recordedAmount: 20000, recordedAt: sec('2026-11-12T02:00:00.000Z'), paymentConfirm: stamp({ decidedBy: 'u-fin', decidedByRole: 'finance', onBehalf: true }) },
    c2: { kind: 'site_visit', status: 'recorded', company: 'BK', clientName: 'Fee Client', createdBy: 'u-sales', recordedAmount: 5000, recordedAt: sec('2026-11-12T02:00:00.000Z'), paymentConfirm: stamp() },
  },
  job_projects: {
    p1: { projectNo: 'JP-2611-001', stage: 'delivered', company: 'BK', clientName: 'Acme Foods', quoteNumber: 'BK-1', salesOrderId: 'o1', createdBy: 'u-sales', updatedAt: sec('2026-11-14T02:00:00.000Z'), refunds: [{ amount: 5000, date: '2026-11-15', method: 'Cash', by: 'Neil' }] },
    p2: { projectNo: 'JP-2611-002', stage: 'completed', company: 'BK', clientName: 'Beta <b>Bakery</b>', quoteNumber: 'BK-2', createdBy: 'u-sales', updatedAt: sec('2026-11-16T02:00:00.000Z') },
    p3: { projectNo: 'JP-2611-003', stage: 'in_production', company: 'BK', clientName: 'Still Building', createdBy: 'u-sales' },
    p4: { projectNo: 'JP-2611-004', stage: 'delivered', company: 'BS', clientName: 'Steel Client', createdBy: 'u-sales' },
    p5: { projectNo: 'JP-2611-005', stage: 'paid', company: 'BI', clientName: 'Gamma Hotel', quoteNumber: 'BI-5', createdBy: 'u-sales', updatedAt: sec('2026-11-05T02:00:00.000Z') },
    p6: { projectNo: 'JP-2611-006', stage: 'cancelled', company: 'BK', clientName: 'Cancelled Co', createdBy: 'u-sales' },
  },
  client_ratings: {
    p5: { projectId: 'p5', clientName: 'Gamma Hotel', company: 'BI', salesUid: 'u-sales', stars: 5, comment: 'Loved it <script>alert(1)</script>', source: 'president', heardVia: 'call', approved: true, approvedAt: sec('2026-11-05T04:00:00.000Z') },
  },
  sales_kpi: {},
});
const cardOn = (over = {}) => ({ kpiSource: 'sales', startMonth: '2027-01', weights: { sales: 0.7, satisfaction: 0.3 }, targets: {}, defaultTarget: 100000, scope: 'all', ...over });

function makeEnv(who = PRES, { seed = baseSeed(), extra = {} } = {}) {
  const env = makeBaseEnv(who, { seed });
  const dom = makeDom();
  const ctx = env.ctx;
  // the real Manila-time helper (the harness stub ignores its argument) and the real company registry semantics (unknown codes are NOT internal)
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' });
  ctx.bizDate = (d) => fmt.format(d || new Date('2026-11-19T04:00:00Z'));
  ctx.isInternalQuoteCompany = (co) => co === 'BK' || co === 'BI';
  ctx.openPage = (title, body, footer) => { const p = dom.host(); p.title = title; p.innerHTML = String(body || '') + String(footer || ''); env.pages.push(p); return p; };
  Object.assign(ctx, extra);
  env.dom = dom;
  env.load(CORE, 'js/sales-kpi-core.js');
  env.load(SCREEN, 'js/screens/sales-kpi.js');
  env.UI = ctx.window.SalesKpiUI;
  env.K = ctx.window.SalesKpi;
  env.written = () => env.db.log.filter((l) => l.op !== 'query');
  env.queries = (coll) => env.db.log.filter((l) => l.op === 'query' && l.path === coll);
  return env;
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('the pure builders (step 3)', () => {
  const env = makeEnv();
  const { UI } = env;
  it('buildKpiDoc: the document the card writes — fixed 70 / 30 weights, scope "all", off is kpiSource "tasks", a blank default target is null', () => {
    const r = UI.buildKpiDoc({ on: true, startMonth: '2027-01', defaultTarget: '100000', overrides: [{ month: '2026-12', amount: '150000' }] });
    assert.equal(r.ok, true);
    same(r.doc, { kpiSource: 'sales', startMonth: '2027-01', weights: { sales: 0.7, satisfaction: 0.3 }, targets: { '2026-12': 150000 }, defaultTarget: 100000, scope: 'all' });
    same(UI.buildKpiDoc({ on: false, startMonth: '2027-01', defaultTarget: '', overrides: [] }).doc, { kpiSource: 'tasks', startMonth: '2027-01', weights: { sales: 0.7, satisfaction: 0.3 }, targets: {}, defaultTarget: null, scope: 'all' });
    assert.equal(UI.buildKpiDoc({ on: true, startMonth: '2027-01', defaultTarget: '  ', overrides: [] }).doc.defaultTarget, null);
    assert.equal(UI.buildKpiDoc({ on: true, startMonth: '2027-01', defaultTarget: '100,000.456', overrides: [] }).doc.defaultTarget, 100000.46);
  });
  it('buildKpiDoc: refuses a bad start month, a default that is not above 0, and a single-month target that is not valid — in plain words', () => {
    const bad = (f) => UI.buildKpiDoc({ on: true, startMonth: '2027-01', defaultTarget: '', overrides: [], ...f });
    assert.match(bad({ startMonth: '' }).error, /first month paid/);
    assert.match(bad({ startMonth: '2027-1' }).error, /first month paid/);
    for (const v of ['0', '-5', 'abc']) assert.match(bad({ defaultTarget: v }).error, /above ₱0, or leave it blank/, v);
    assert.match(bad({ overrides: [{ month: '', amount: '5' }] }).error, /no valid month/);
    assert.match(bad({ overrides: [{ month: '2026-12', amount: '0' }] }).error, /December 2026 must be above ₱0/);
    assert.equal(bad({ startMonth: '' }).ok, false);
  });
  it('draftOf: a person with no document starts ON, from 2027-01, with a BLANK target (nothing is prefilled); an existing document is read back', () => {
    same(UI.draftOf(null), { on: true, startMonth: '2027-01', defaultTarget: '', overrides: [] });
    same(UI.draftOf(cardOn({ kpiSource: 'tasks', startMonth: '2027-03', defaultTarget: null, targets: { '2027-02': 90000, '2026-12': 80000, junk: 5 } })),
      { on: false, startMonth: '2027-03', defaultTarget: '', overrides: [{ month: '2026-12', amount: '80000' }, { month: '2027-02', amount: '90000' }] });
  });
  it('staffOptions: named, current staff only (no leavers, no HR-managed worker logins), sorted; preselect picks the one card that is on, else the one "Sales Manager"', () => {
    const users = Object.entries(baseSeed().users).map(([id, u]) => ({ id, ...u }));
    const staff = UI.staffOptions(users, {});
    assert.deepEqual(staff.map((s) => s.uid), ['u-pres', 'u-prod', 'u-fin', 'u-sales'], 'sorted by name: Neil, Rene, Shaira, Uriel');
    assert.equal(UI.preselect(users, staff), 'u-sales');
    const on = UI.staffOptions(users, { 'u-prod': cardOn() });
    assert.equal(UI.preselect(users, on), 'u-prod', 'the one card that is on wins');
    assert.equal(UI.preselect(users.map((u) => ({ ...u, title: '' })), staff), '', 'nobody is guessed');
  });
  it('waitingRows: delivered, completed or paid jobs of Barro Kitchens / Barro Industries with no rating — newest activity first; not in production, cancelled, Brilliance Steel or rated', () => {
    const projects = Object.entries(baseSeed().job_projects).map(([id, p]) => ({ id, ...p }));
    const ratings = Object.entries(baseSeed().client_ratings).map(([id, r]) => ({ id, ...r }));
    assert.deepEqual(UI.waitingRows(projects, ratings).map((p) => p.id), ['p2', 'p1']);
    assert.deepEqual(UI.waitingRows(projects, []).map((p) => p.id), ['p2', 'p1', 'p5']);
  });
  it('refundsOf: every refund of every job, flat, carrying the job\'s company and creator', () => {
    const projects = Object.entries(baseSeed().job_projects).map(([id, p]) => ({ id, ...p }));
    same(UI.refundsOf(projects), [{ id: 'p1:0', projectId: 'p1', clientName: 'Acme Foods', quoteNumber: 'BK-1', company: 'BK', createdBy: 'u-sales', amount: 5000, date: '2026-11-15' }]);
  });
  it('starsHtml: five Lucide stars (no emoji), n of them gold, with a spoken label', () => {
    const h = UI.html.stars(3);
    assert.equal((h.match(/data-lucide="star"/g) || []).length, 5);
    assert.equal((h.match(/#f59f00/g) || []).length, 3);
    assert.match(h, /aria-label="3 out of 5 stars"/);
    assert.ok(!/[★☆⭐]/.test(h));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('step 3 — the President\'s Sales KPI card (Finance › Payroll & HR › Sales KPI)', () => {
  async function open(who = PRES, opts = {}) {
    const env = makeEnv(who, opts);
    const host = env.dom.host();
    await env.UI.renderScreen(host, env.ctx.currentUser, env.ctx.currentRole);
    await settle();
    return { env, host, $: (id) => host.querySelector('#' + id) };
  }
  it('opens on Uriel (the Sales Manager) when nobody is configured yet, with the picker listing current staff', async () => {
    const { $ } = await open();
    const sel = $('sk-staff');
    assert.equal(sel.value, 'u-sales');
    const html = $('sk-staff-wrap').innerHTML;
    assert.ok(html.includes('Uriel Sales') && html.includes('Shaira Finance') && html.includes('Neil Barro'));
    assert.ok(!html.includes('Old Timer') && !html.includes('Shop Worker'), 'leavers and worker logins are not offered');
  });
  it('a new card: switched on, first month 2027-01, the default target field BLANK and NOT prefilled, weights shown read-only as 70/30, no peso figure anywhere in it', async () => {
    const { $ } = await open();
    assert.equal($('sk-on').checked, true);
    assert.equal($('sk-start').value, '2027-01');
    assert.equal($('sk-default').value, '');
    const card = $('sk-config').innerHTML;
    assert.ok(plain(card).includes('Confirmed sales 70% · Client rating 30%'));
    assert.ok(/placeholder="Not set yet"/.test(card));
    assert.ok(!/₱\s*\d/.test(plain(card)), 'no peso figure is shown before the President types one');
    assert.deepEqual($('sk-config').querySelectorAll('input').map((e) => e.id), ['sk-on', 'sk-start', 'sk-default', 'sk-ovr-month', 'sk-ovr-amt'], 'the weights and the scope are not inputs');
  });
  it('Save writes sales_kpi/<uid> once: on, start month, the typed default, single-month targets, 70 / 30, scope "all", updatedBy the President', async () => {
    const { env, $ } = await open();
    $('sk-default').value = '100000';
    $('sk-ovr-month').value = '2026-12';
    $('sk-ovr-amt').value = '150000';
    await $('sk-ovr-add').click();
    await $('sk-save').click();
    await settle();
    const w = env.written();
    assert.equal(w.length, 1, JSON.stringify(w.map((x) => x.path)));
    assert.equal(w[0].op, 'set');
    assert.equal(w[0].path, 'sales_kpi/u-sales');
    const d = w[0].data;
    same({ kpiSource: d.kpiSource, startMonth: d.startMonth, weights: d.weights, targets: d.targets, defaultTarget: d.defaultTarget, scope: d.scope, updatedBy: d.updatedBy },
      { kpiSource: 'sales', startMonth: '2027-01', weights: { sales: 0.7, satisfaction: 0.3 }, targets: { '2026-12': 150000 }, defaultTarget: 100000, scope: 'all', updatedBy: 'u-pres' });
    assert.ok(d.updatedAt && d.updatedAt.__op === 'ts', 'a server timestamp');
    assert.ok(env.toastMsgs().includes('Sales KPI saved for Uriel Sales.'));
    assert.equal(env.audits.length, 1);
  });
  it('a blank default stays blank (null) when saved — the scorecard then says "No target set"', async () => {
    const { env, $ } = await open();
    await $('sk-save').click();
    await settle();
    assert.equal(env.written()[0].data.defaultTarget, null);
    assert.equal(env.db.store.sales_kpi.get('u-sales').defaultTarget, null);
  });
  it('switching it off writes kpiSource "tasks" and keeps the figures; the next open shows it off', async () => {
    const seed = baseSeed(); seed.sales_kpi['u-sales'] = cardOn({ targets: { '2026-12': 150000 } });
    const { env, $ } = await open(PRES, { seed });
    assert.equal($('sk-on').checked, true);
    assert.equal($('sk-default').value, '100000');
    $('sk-on').checked = false;
    await $('sk-save').click();
    await settle();
    const d = env.written()[0].data;
    same({ kpiSource: d.kpiSource, defaultTarget: d.defaultTarget, targets: d.targets }, { kpiSource: 'tasks', defaultTarget: 100000, targets: { '2026-12': 150000 } });
  });
  it('a single-month target can be added, replaced and removed before saving; a bad month or amount shows an error and writes nothing', async () => {
    const seed = baseSeed(); seed.sales_kpi['u-sales'] = cardOn({ targets: { '2026-12': 150000 } });
    const { env, $ } = await open(PRES, { seed });
    $('sk-ovr-month').value = ''; $('sk-ovr-amt').value = '5';
    await $('sk-ovr-add').click();
    assert.match($('sk-err').textContent, /Pick the month/);
    $('sk-ovr-month').value = '2027-02'; $('sk-ovr-amt').value = '0';
    await $('sk-ovr-add').click();
    assert.match($('sk-err').textContent, /above ₱0 for February 2027/);
    assert.equal(env.written().length, 0);
    $('sk-ovr-month').value = '2026-12'; $('sk-ovr-amt').value = '175000';
    await $('sk-ovr-add').click();                                  // replaces December
    $('sk-ovr-month').value = '2027-02'; $('sk-ovr-amt').value = '90000';
    await $('sk-ovr-add').click();
    assert.ok(plain($('sk-config').innerHTML).includes('December 2026 — ₱175,000.00') && plain($('sk-config').innerHTML).includes('February 2027 — ₱90,000.00'));
    const rm = $('sk-config').querySelectorAll('.sk-ovr-rm');
    assert.equal(rm.length, 2);
    await rm[0].click();                                            // removes December
    await $('sk-save').click();
    await settle();
    same(env.written()[0].data.targets, { '2027-02': 90000 });
  });
  it('a session that is no longer the President when it taps Save is refused in plain words and writes nothing', async () => {
    const { env, $ } = await open();
    env.ctx.currentRole = 'employee';
    await $('sk-save').click(); await settle();
    assert.match($('sk-err').textContent, /Only the President changes the Sales KPI\./);
    assert.equal(env.written().length, 0);
  });
  it('a bad start month or default target writes nothing and says why', async () => {
    const { env, $ } = await open();
    $('sk-start').value = '';
    await $('sk-save').click();
    assert.match($('sk-err').textContent, /first month paid/);
    $('sk-start').value = '2027-01'; $('sk-default').value = '-3';
    await $('sk-save').click();
    assert.match($('sk-err').textContent, /above ₱0, or leave it blank/);
    assert.equal(env.written().length, 0);
  });
  it('Finance and a manager see the scorecard and a READ-ONLY summary: no switch, no inputs, no Save, no waiting list; only people who are set up are listed', async () => {
    const seed = baseSeed(); seed.sales_kpi['u-sales'] = cardOn({ targets: { '2026-12': 150000 } });
    for (const who of [FIN, MGR]) {
      const { env, $, host } = await open(who, { seed });
      assert.equal($('sk-save'), null, who.role);
      assert.equal($('sk-on'), null);
      assert.equal($('sk-default'), null);
      assert.equal($('sk-waiting'), null, 'the rating list is the President\'s');
      const cfg = plain($('sk-config').innerHTML);
      assert.ok(cfg.includes('Switched on') && cfg.includes('January 2027') && cfg.includes('Default monthly target: ₱100,000.00') && cfg.includes('December 2026 ₱150,000.00'), cfg);
      assert.ok(!plain($('sk-staff-wrap').innerHTML).includes('Rene Production'), 'only people with a card are listed');
      assert.ok(plain(host.innerHTML).includes('Preview — not yet used for pay'));
      assert.equal(env.written().length, 0);
    }
  });
  it('Finance with nobody set up sees "The President sets it up here", not a broken picker', async () => {
    const { host } = await open(FIN);
    assert.ok(plain(host.innerHTML).includes('No one has a Sales KPI set up yet'));
  });
  it('a failed read says so with a Try again button; nothing is guessed', async () => {
    const env = makeEnv(PRES);
    env.db.collection = (c) => ({ get: async () => { throw Object.assign(new Error('offline'), { code: 'unavailable' }); }, doc: () => ({ get: async () => { throw new Error('x'); } }), where: () => ({ get: async () => { throw new Error('x'); } }) });
    const host = env.dom.host();
    await env.UI.renderScreen(host);
    await settle();
    assert.ok(plain(host.innerHTML).includes('Could not open the Sales KPI (unavailable)'));
    assert.ok(host.querySelector('#sk-retry'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('step 5 — the scorecard preview ("Preview — not yet used for pay")', () => {
  async function screen(who, seed) {
    const env = makeEnv(who, { seed });
    const host = env.dom.host();
    await env.UI.renderScreen(host);
    await settle();
    return { env, host, $: (id) => host.querySelector('#' + id) };
  }
  const withCard = (card = cardOn()) => { const s = baseSeed(); s.sales_kpi['u-sales'] = card; return s; };

  it('shows the KPI, the sales line and the rating line in the owner\'s plain words, and the label that it is not used for pay yet', async () => {
    const { $ } = await screen(PRES, withCard());
    const c = $('sk-scorecard').innerHTML;
    assert.ok(plain(c).includes('Preview — not yet used for pay'));
    assert.ok(plain(c).includes('Uriel Sales — scorecard — November 2026'));
    // confirmed: 25,000 (the President) + 20,000 (Finance for him) − 5,000 refund = 40,000 of 100,000; one 5-star rating
    assert.equal(plain($('sk-headline').innerHTML), 'KPI 58%');                                  // 0.7 × 0.4 + 0.3 × 1
    assert.equal(plain($('sk-line-sales').innerHTML), 'Sales: ₱40,000.00 confirmed of ₱100,000.00 target = 40% (counts 70%)');
    assert.equal(plain($('sk-line-rating').innerHTML), 'Client rating: 5.0 of 5 from 1 client = 100% (counts 30%)');
    assert.equal($('sk-line-note'), null);
  });
  it('the counted payments (client, amount, date confirmed), the refund, who stood in, and the client comments sit behind "Show payments and comments"', async () => {
    const { $ } = await screen(PRES, withCard());
    assert.ok($('sk-details').classList.contains('hidden'));
    await $('sk-more').click();
    assert.ok(!$('sk-details').classList.contains('hidden'));
    const d = plain($('sk-details').innerHTML);
    assert.ok(d.includes('Payments counted in November 2026 (2)'), d);
    assert.ok(d.includes('Acme Foods First payment · confirmed Nov 10, 2026 · BK-1 ₱25,000.00'), d);
    assert.ok(d.includes('Acme Foods Balance · confirmed Nov 12, 2026 · by Finance, for the President ₱20,000.00'), d);
    assert.ok(d.includes('Refund · Nov 15, 2026') && d.includes('−₱5,000.00'), d);
    assert.ok(d.includes('Confirmed ₱45,000.00 − refunds ₱5,000.00 = ₱40,000.00 counted.'), d);
    assert.ok(!d.includes('Steel Client') && !d.includes('Fee Client') && !d.includes('Waiting Co'), 'Brilliance Steel, a site-visit fee and an unconfirmed order are not counted');
    assert.ok(d.includes('Gamma Hotel') && d.includes('Heard by call · Nov 5, 2026'), d);
    assert.ok(d.includes('Loved it <script>alert(1)</script>'), 'the comment is shown (as text)');
    assert.ok($('sk-more').innerHTML.includes('Hide payments and comments'));
  });
  it('client names and comments are escaped (a name that looks like markup is text, never markup)', async () => {
    const seed = withCard();
    seed.sales_orders.o1.clientName = '<img src=x onerror=alert(1)>';
    const { $ } = await screen(PRES, seed);
    await $('sk-more').click();
    const raw = $('sk-details').innerHTML;
    assert.ok(!raw.includes('<img src=x') && raw.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.ok(!raw.includes('<script>alert(1)</script>') && raw.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  });
  it('no target set: "No target set for <Month>", no invented number, and the real confirmed total as a fact', async () => {
    const { $ } = await screen(PRES, withCard(cardOn({ defaultTarget: null })));
    assert.equal(plain($('sk-headline').innerHTML), 'No target set for November 2026');
    assert.equal($('sk-line-sales'), null);
    const c = plain($('sk-scorecard').innerHTML);
    assert.ok(c.includes('Set the default target') && c.includes('Confirmed so far: ₱40,000.00.'), c);
    assert.ok(!/KPI \d+%/.test(c));
    const fin = await screen(FIN, withCard(cardOn({ defaultTarget: null })));
    assert.ok(plain(fin.$('sk-scorecard').innerHTML).includes('The President sets the monthly target.'));
  });
  it('a month with no ratings says the KPI is the sales score only; the month buttons move the scorecard and stop at the current month', async () => {
    const seed = withCard(cardOn({ targets: { '2026-10': 80000 } }));
    seed.sales_orders.o1.recordedAt = sec('2026-10-10T02:00:00.000Z');
    const { $ } = await screen(PRES, seed);
    assert.ok($('sk-next').disabled, 'cannot go past this month');
    await $('sk-prev').click();                                                                  // October: the 25,000 order, a rating from November is not borrowed
    assert.ok(plain($('sk-scorecard').innerHTML).includes('October 2026'));
    assert.equal(plain($('sk-headline').innerHTML), 'KPI 31%');                                  // 25,000 of the month's own 80,000 target = 31.25%, sales only
    assert.equal(plain($('sk-line-note').innerHTML), 'No client ratings this month, so the KPI is the sales score only.');
    assert.equal(plain($('sk-line-sales').innerHTML), 'Sales: ₱25,000.00 confirmed of ₱80,000.00 target = 31% (counts 100%)');
    await $('sk-next').click();
    assert.ok(plain($('sk-scorecard').innerHTML).includes('November 2026'));
  });
  it('a failed read shows "Could not load the scorecard" with Try again — no number, no fallback', async () => {
    const { env, $ } = await screen(PRES, withCard());
    const real = env.db.collection;
    let fail = true;
    env.db.collection = (c) => { if (fail && c === 'payment_claims') return { where: () => ({ get: async () => { throw Object.assign(new Error('denied'), { code: 'permission-denied' }); } }) }; return real(c); };
    await $('sk-staff').fire('change');
    await settle();
    assert.ok(plain($('sk-scorecard').innerHTML).includes('Could not load the scorecard (permission-denied)'));
    assert.ok(!/KPI \d+%/.test(plain($('sk-scorecard').innerHTML)));
    fail = false;
    await $('sk-retry').click();
    await settle();
    assert.equal(plain($('sk-headline').innerHTML), 'KPI 58%');
  });
  it('the President and Finance read every rating; the salesperson asks only for the ratings that name them (the rule that lets them read at all)', async () => {
    const seed = withCard();
    const pres = await screen(PRES, seed);
    assert.ok(pres.env.queries('client_ratings').some((q) => q.filters.length === 0));
    const fin = await screen(FIN, withCard());
    assert.ok(fin.env.queries('client_ratings').some((q) => q.filters.length === 0));
    const env = makeEnv(SALES, { seed: withCard() });
    const host = env.dom.host();
    await env.UI.renderMyScorecard(host);
    await settle();
    const qs = env.queries('client_ratings');
    assert.equal(qs.length, 1);
    same(qs[0].filters, [['salesUid', 'u-sales']]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('step 5 — "My scorecard" on the Sales home (Uriel)', () => {
  async function mine(who, seed) {
    const env = makeEnv(who, { seed });
    const host = env.dom.host();
    await env.UI.renderMyScorecard(host);
    await settle();
    return { env, host };
  }
  const withCard = (card) => { const s = baseSeed(); if (card) s.sales_kpi['u-sales'] = card; return s; };

  it('Uriel, with his card on, sees "My scorecard — <Month>", the preview label, his KPI and the comments (Q9a: he sees client comments)', async () => {
    const { host } = await mine(SALES, withCard(cardOn()));
    const t = plain(host.innerHTML);
    assert.ok(t.includes('My scorecard — November 2026') && t.includes('Preview — not yet used for pay'), t);
    assert.equal(plain(host.querySelector('#sk-headline').innerHTML), 'KPI 58%');
    await host.querySelector('#sk-more').click();
    assert.ok(plain(host.querySelector('#sk-details').innerHTML).includes('Loved it <script>alert(1)</script>'));
  });
  it('shows his own books-free view: client, amount, date — no cost, margin, contract or bank figures', async () => {
    const { host } = await mine(SALES, withCard(cardOn()));
    await host.querySelector('#sk-more').click();
    const t = plain(host.innerHTML);
    for (const banned of ['margin', 'Margin', 'capital', 'Capital', 'cost', 'Cost', 'bank', 'Bank', 'contract', 'Contract']) assert.ok(!t.includes(banned), `the scorecard must not mention ${banned}`);
  });
  it('nothing at all (no card, no error) for: no sales_kpi document, a card that is off, and everybody else (Production, Finance, the President)', async () => {
    for (const [who, seed] of [[SALES, withCard(null)], [SALES, withCard(cardOn({ kpiSource: 'tasks' }))], [PROD, withCard(cardOn())], [FIN, withCard(cardOn())], [PRES, withCard(cardOn())]]) {
      const { host } = await mine(who, seed);
      assert.equal(host.innerHTML, '', `${who.name}`);
    }
  });
  it('a person who cannot read their own document is shown nothing (not an error card)', async () => {
    const env = makeEnv(SALES, { seed: withCard(cardOn()) });
    const real = env.db.collection;
    env.db.collection = (c) => (c === 'sales_kpi' ? { doc: () => ({ get: async () => { throw new Error('offline'); } }) } : real(c));
    const host = env.dom.host();
    await env.UI.renderMyScorecard(host);
    await settle();
    assert.equal(host.innerHTML, '');
  });
  it('a failed read AFTER the gate is shown to him with Try again', async () => {
    const env = makeEnv(SALES, { seed: withCard(cardOn()) });
    const real = env.db.collection;
    env.db.collection = (c) => (c === 'job_projects' ? { get: async () => { throw Object.assign(new Error('slow'), { code: 'deadline-exceeded' }); } } : real(c));
    const host = env.dom.host();
    await env.UI.renderMyScorecard(host);
    await settle();
    assert.ok(plain(host.innerHTML).includes('Could not load the scorecard (deadline-exceeded)'));
    assert.ok(host.querySelector('#sk-retry'));
  });
  it('scope "own": only the payments he recorded and the ratings that name him (a refund of his own job still comes off)', async () => {
    const own = withCard(cardOn({ scope: 'own' }));
    assert.equal(plain((await mine(SALES, own)).host.querySelector('#sk-headline').innerHTML), 'KPI 58%', 'he recorded every payment in the seed');
    for (const o of Object.values(own.sales_orders)) o.createdBy = 'u-someone-else';
    for (const c of Object.values(own.payment_claims)) c.createdBy = 'u-someone-else';
    own.client_ratings.p5.salesUid = 'u-someone-else';
    const other = (await mine(SALES, own)).host;
    assert.equal(plain(other.querySelector('#sk-headline').innerHTML), 'KPI 0%');
    assert.equal(plain(other.querySelector('#sk-line-sales').innerHTML), 'Sales: ₱0.00 confirmed of ₱100,000.00 target = 0% (counts 100%)');
    assert.equal(plain(other.querySelector('#sk-line-note').innerHTML), 'No client ratings this month, so the KPI is the sales score only.');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('step 5 — the Sales page hook, run for real (js/screens/sales.js renderSales)', () => {
  const SALES_SRC = read('js/screens/sales.js');
  async function salesPage(who, card) {
    const seed = baseSeed(); if (card) seed.sales_kpi['u-sales'] = card;
    const env = makeEnv(who, { seed });
    const c = env.dom.host();
    Object.assign(env.ctx, {
      document: { getElementById: () => null }, deptContainer: () => c, sopPanel: (title) => '<div class="sop">' + title + '</div>', chipTabs: () => '<div class="chips"></div>',
      bindChipTabs: () => {}, setSubroute: () => {}, initialSubtab: (d) => d, renderClientProfiles: async () => {},
    });
    env.load(SALES_SRC, 'js/screens/sales.js');
    await env.ctx.window.renderSales(env.ctx.currentUser, env.ctx.currentRole);
    await settle();
    return { env, c, card: c.querySelector('#sales-scorecard') };
  }
  it('Uriel, with his card on, finds "My scorecard" at the top of the Sales page, above the how-to panel; the lazy screen is loaded for it', async () => {
    const { env, c, card } = await salesPage(SALES, cardOn());
    assert.ok(env.ensured.includes('js/screens/sales-kpi.js'));
    const t = plain(card.innerHTML);
    assert.ok(t.includes('My scorecard — November 2026') && t.includes('Preview — not yet used for pay') && t.includes('KPI 58%'), t);
    const page = c._own;                                            // the page's own markup, in document order (the scorecard is painted into the host inside it)
    assert.ok(page.indexOf('Barro Kitchens — Sales') < page.indexOf('id="sales-scorecard"') && page.indexOf('id="sales-scorecard"') < page.indexOf('How Sales works'), 'header, then the scorecard host, then the how-to panel');
    assert.equal(c.querySelectorAll('#sales-scorecard').length, 1);
  });
  it('nobody else gets a card or an error on the Sales page: no document, a card that is off, Production, the President', async () => {
    for (const [who, card] of [[SALES, null], [SALES, cardOn({ kpiSource: 'tasks' })], [PROD, cardOn()], [PRES, cardOn()]]) {
      const { card: host } = await salesPage(who, card);
      assert.equal(host.innerHTML, '', who.name);
    }
  });
  it('the page still draws when the lazy screen cannot be loaded (the hook is silent, never a broken Sales page)', async () => {
    const seed = baseSeed(); seed.sales_kpi['u-sales'] = cardOn();
    const env = makeEnv(SALES, { seed });
    const c = env.dom.host();
    Object.assign(env.ctx, { document: { getElementById: () => null }, deptContainer: () => c, sopPanel: () => '', chipTabs: () => '', bindChipTabs: () => {}, setSubroute: () => {}, initialSubtab: (d) => d, renderClientProfiles: async () => {}, ensureScript: async () => { throw new Error('offline'); } });
    env.load(SALES_SRC, 'js/screens/sales.js');
    await env.ctx.window.renderSales(env.ctx.currentUser, env.ctx.currentRole);
    await settle();
    assert.ok(plain(c.innerHTML).includes('Barro Kitchens — Sales'));
    assert.equal(c.querySelector('#sales-scorecard').innerHTML, '');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('step 4 — Client rating (Phase A: the President enters it)', () => {
  const delivered = (over = {}) => ({ id: 'p1', projectNo: 'JP-2611-001', stage: 'delivered', company: 'BK', clientName: 'Acme Foods', quoteNumber: 'BK-1', salesOrderId: 'o1', createdBy: 'u-sales', ...over });
  const withCard = () => { const s = baseSeed(); s.sales_kpi['u-sales'] = cardOn(); return s; };
  async function row(who, project = delivered(), seed = withCard()) {
    const env = makeEnv(who, { seed });
    const host = env.dom.host();
    await env.UI.renderJobRating(host, project);
    await settle();
    return { env, host, $: (id) => host.querySelector('#' + id) };
  }
  it('the President sees "Client rating — Not rated yet" with a Rate this job button on a delivered, completed or paid job', async () => {
    for (const stage of ['delivered', 'completed', 'paid']) {
      const { host, $ } = await row(PRES, delivered({ stage }));
      assert.ok(plain(host.innerHTML).includes('Client rating') && plain(host.innerHTML).includes('Not rated yet'), stage);
      assert.equal(plain($('sk-rate-btn').innerHTML), 'Rate this job', stage);
    }
  });
  it('nothing for a job that is not delivered yet (won, in design, in production, for delivery) or was cancelled', async () => {
    for (const stage of ['won', 'in_design', 'in_production', 'for_delivery', 'cancelled']) {
      const { host } = await row(PRES, delivered({ stage }));
      assert.equal(host.innerHTML, '', stage);
    }
  });
  it('nothing for anyone but the President (Sales, Finance, a manager, Production) — the row does not even read the rating', async () => {
    for (const who of [SALES, FIN, MGR, PROD]) {
      const { env, host } = await row(who);
      assert.equal(host.innerHTML, '', who.role);
      assert.equal(env.queries('client_ratings').length, 0);
    }
  });
  it('the job-detail hook is the President\'s only and only from "delivered" on (textual pin on production.js)', () => {
    const PROD_SRC = read('js/screens/production.js');
    assert.ok(PROD_SRC.includes("((typeof isRealPresident==='function' && isRealPresident()) && ['delivered','completed','paid'].includes(p.stage))?'<div id=\"jpd-rating\"></div>':''"));
    assert.ok(PROD_SRC.includes("window.ensureScript('js/screens/sales-kpi.js').then(()=>{ if (panelLive(jpdPanel) && window.SalesKpiUI) return window.SalesKpiUI.renderJobRating(_rateHost, p); }).catch(()=>{});"));
  });
  it('Rate this job opens the sheet; Save with no stars says "Pick 1 to 5 stars." and writes nothing', async () => {
    const { env, $ } = await row(PRES);
    await $('sk-rate-btn').click();
    await settle();
    const sheet = env.pages[env.pages.length - 1];
    assert.equal(sheet.title, 'Client rating — Acme Foods');
    assert.equal(sheet.querySelectorAll('.rt-star').length, 5);
    await sheet.querySelector('#rt-save').click();
    assert.match(sheet.querySelector('#rt-err').textContent, /Pick 1 to 5 stars\./);
    assert.equal(env.written().length, 0);
  });
  it('the sheet title is plain text (openPage sets it with textContent): no tag survives, and an "&" or an apostrophe is not printed as an entity', async () => {
    const title = async (clientName) => {
      const { env, $ } = await row(PRES, delivered({ clientName }));
      await $('sk-rate-btn').click();
      await settle();
      return env.pages[env.pages.length - 1].title;
    };
    assert.equal(await title('<b>Bold</b> & Sons'), 'Client rating — bBold/b & Sons');
    assert.equal(await title("Mang Tomas' Kitchen & Grill"), "Client rating — Mang Tomas' Kitchen & Grill");
    assert.ok(!(await title('<img src=x onerror=alert(1)>')).includes('<'));
  });
  it('Save writes client_ratings/<projectId>: stars (a whole number 1–5), note, how he heard it, whose sale, the company, approved by the President', async () => {
    const { env, host, $ } = await row(PRES);
    await $('sk-rate-btn').click();
    await settle();
    const sheet = env.pages[env.pages.length - 1];
    await sheet.querySelectorAll('.rt-star')[3].click();                       // 4 stars
    assert.equal(sheet.querySelector('#rt-stars-label').textContent, '4 of 5');
    assert.equal(sheet.querySelectorAll('.rt-star')[3].getAttribute('aria-pressed'), 'true');
    assert.equal(sheet.querySelectorAll('.rt-star')[4].getAttribute('aria-pressed'), 'false');
    sheet.querySelector('#rt-note').value = '  Very good, would order again  ';
    sheet.querySelector('#rt-via').value = 'message';
    await sheet.querySelector('#rt-save').click();
    await settle();
    const w = env.written();
    assert.equal(w.length, 1, JSON.stringify(w.map((x) => x.path)));
    assert.equal(w[0].op, 'set');
    assert.equal(w[0].path, 'client_ratings/p1');
    const d = w[0].data;
    same({ projectId: d.projectId, orderId: d.orderId, clientName: d.clientName, quoteNumber: d.quoteNumber, company: d.company, salesUid: d.salesUid, stars: d.stars, comment: d.comment, source: d.source, heardVia: d.heardVia, approved: d.approved, approvedBy: d.approvedBy, approvedByName: d.approvedByName },
      { projectId: 'p1', orderId: 'o1', clientName: 'Acme Foods', quoteNumber: 'BK-1', company: 'BK', salesUid: 'u-sales', stars: 4, comment: 'Very good, would order again', source: 'president', heardVia: 'message', approved: true, approvedBy: 'u-pres', approvedByName: 'Neil Barro' });
    for (const k of ['approvedAt', 'createdAt', 'updatedAt']) assert.equal(d[k] && d[k].__op, 'ts', k);
    // what the rules require of a rating: a whole number of stars, 1 to 5
    assert.ok(Number.isInteger(d.stars) && d.stars >= 1 && d.stars <= 5);
    assert.ok(env.toastMsgs().includes('Rating saved.'));
    assert.equal(env.closes, 1);
    await settle();
    assert.ok(plain(host.innerHTML).includes('Heard by message'), 'the row now shows the rating');
  });
  it('whose sale: the one user whose Sales KPI is on; with none or several on, the person who recorded the sale (the order\'s creator, else the job\'s)', async () => {
    const save = async (seed, project) => {
      const { env, $ } = await row(PRES, project, seed);
      await $('sk-rate-btn').click(); await settle();
      const sheet = env.pages[env.pages.length - 1];
      await sheet.querySelectorAll('.rt-star')[4].click();
      await sheet.querySelector('#rt-save').click(); await settle();
      return env.written()[0].data.salesUid;
    };
    // the order o1 was recorded by u-sales; the JOB was created by somebody else, so the two can never be mistaken for each other
    const job = (over = {}) => delivered({ createdBy: 'u-job-creator', ...over });
    assert.equal(await save(withCard(), job()), 'u-sales', 'exactly one card on (and it is not the job\'s creator)');
    assert.equal(await save(baseSeed(), job()), 'u-sales', 'none on: the ORDER\'s creator, not the job\'s');
    assert.equal(await save(baseSeed(), job({ salesOrderId: undefined })), 'u-job-creator', 'no order at all: the job\'s creator');
    const two = baseSeed(); two.sales_kpi['u-prod'] = cardOn(); two.sales_kpi['u-fin'] = cardOn();
    assert.equal(await save(two, job()), 'u-sales', 'two on: the order\'s creator — never "the first one on"');
    const off = baseSeed(); off.sales_kpi['u-prod'] = cardOn({ kpiSource: 'tasks' });
    assert.equal(await save(off, job()), 'u-sales', 'a card that is off is not "on"');
    const other = baseSeed(); other.sales_kpi = { 'u-prod': cardOn() };
    assert.equal(await save(other, job()), 'u-prod', 'the one user whose card is on, whoever recorded the sale');
  });
  it('editing keeps the rating\'s month and owner: only stars, note, how heard and the edit stamp change — never approvedAt, createdAt or the job', async () => {
    const seed = withCard();
    seed.client_ratings.p1 = { projectId: 'p1', orderId: 'o1', clientName: 'Acme Foods', company: 'BK', salesUid: 'u-sales', stars: 5, comment: 'Great', source: 'president', heardVia: 'in_person', approved: true, approvedBy: 'u-pres', approvedAt: sec('2026-10-30T02:00:00.000Z'), createdAt: sec('2026-10-30T02:00:00.000Z') };
    const { env, host, $ } = await row(PRES, delivered(), seed);
    assert.ok(plain(host.innerHTML).includes('Heard by in person') && plain(host.innerHTML).includes('counts in October 2026'), plain(host.innerHTML));
    assert.equal(plain($('sk-rate-btn').innerHTML), 'Edit');
    await $('sk-rate-btn').click(); await settle();
    const sheet = env.pages[env.pages.length - 1];
    assert.equal(sheet.querySelector('#rt-note').value, 'Great');
    assert.equal(sheet.querySelector('#rt-via').value, 'in_person');
    assert.equal(sheet.querySelectorAll('.rt-star')[4].getAttribute('aria-pressed'), 'true', 'pre-filled with the saved stars');
    await sheet.querySelectorAll('.rt-star')[1].click();                      // 2 stars
    sheet.querySelector('#rt-note').value = 'Delivery was late';
    await sheet.querySelector('#rt-save').click(); await settle();
    const w = env.written();
    assert.equal(w.length, 1);
    assert.equal(w[0].op, 'update');
    assert.deepEqual(Object.keys(w[0].patch).sort(), ['comment', 'heardVia', 'stars', 'updatedAt', 'updatedBy']);
    same({ stars: w[0].patch.stars, comment: w[0].patch.comment, heardVia: w[0].patch.heardVia, updatedBy: w[0].patch.updatedBy }, { stars: 2, comment: 'Delivery was late', heardVia: 'in_person', updatedBy: 'u-pres' });
    assert.equal(env.db.store.client_ratings.get('p1').approvedAt.seconds, sec('2026-10-30T02:00:00.000Z').seconds, 'still counts in October');
  });
  it('a rating that is still waiting for approval (approved false) is approved by the President\'s save', async () => {
    const seed = withCard();
    seed.client_ratings.p1 = { projectId: 'p1', stars: 3, comment: '', source: 'client', approved: false, salesUid: 'u-sales', company: 'BK' };
    const { env, $ } = await row(PRES, delivered(), seed);
    await $('sk-rate-btn').click(); await settle();
    const sheet = env.pages[env.pages.length - 1];
    await sheet.querySelector('#rt-save').click(); await settle();
    const p = env.written()[0].patch;
    same({ approved: p.approved, approvedBy: p.approvedBy }, { approved: true, approvedBy: 'u-pres' });
    assert.equal(p.approvedAt.__op, 'ts');
  });
  it('only the President can open the sheet; a job that is not delivered cannot be rated; a failed save says so and keeps the sheet', async () => {
    for (const who of [SALES, FIN, MGR]) {
      const env = makeEnv(who, { seed: withCard() });
      await env.UI.openRatingSheet(delivered());
      assert.ok(env.toastMsgs().includes('Only the President records a client rating.'), who.role);
      assert.equal(env.pages.length, 0);
    }
    const env = makeEnv(PRES, { seed: withCard() });
    await env.UI.openRatingSheet(delivered({ stage: 'in_production' }));
    assert.ok(env.toastMsgs().includes('A job can be rated once it is delivered.'));
    const e2 = makeEnv(PRES, { seed: withCard() });
    await e2.UI.openRatingSheet(delivered(), () => {});
    const sheet = e2.pages[0];
    await sheet.querySelectorAll('.rt-star')[2].click();
    const real = e2.db.collection;
    e2.db.collection = (c) => (c === 'client_ratings' ? { doc: () => ({ get: async () => ({ exists: false, data: () => undefined }), set: async () => { throw Object.assign(new Error('denied'), { code: 'permission-denied' }); } }) } : real(c));
    await sheet.querySelector('#rt-save').click(); await settle();
    assert.match(sheet.querySelector('#rt-err').textContent, /Could not save the rating: denied/);
    assert.equal(e2.closes, 0, 'the sheet stays open');
  });
  it('a session that is no longer the President when it taps Save is refused in plain words and writes nothing', async () => {
    const { env, $ } = await row(PRES);
    await $('sk-rate-btn').click(); await settle();
    const sheet = env.pages[env.pages.length - 1];
    await sheet.querySelectorAll('.rt-star')[2].click();
    env.ctx.currentRole = 'employee';
    await sheet.querySelector('#rt-save').click(); await settle();
    assert.match(sheet.querySelector('#rt-err').textContent, /Only the President records a client rating\./);
    assert.equal(env.written().length, 0);
  });
  it('Brilliance Steel jobs can be rated but say they do not count toward the Sales KPI', async () => {
    const { host } = await row(PRES, delivered({ company: 'BS' }));
    assert.ok(plain(host.innerHTML).includes('Brilliance Steel jobs do not count toward the Sales KPI.'));
    const { host: bk } = await row(PRES, delivered({ company: 'BK' }));
    assert.ok(!plain(bk.innerHTML).includes('Brilliance Steel'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('step 4 — "Jobs waiting for a rating" on the President\'s Sales KPI screen', () => {
  async function screen(who = PRES, seed = baseSeed()) {
    const env = makeEnv(who, { seed });
    const host = env.dom.host();
    await env.UI.renderScreen(host);
    await settle();
    return { env, host, $: (id) => host.querySelector('#' + id) };
  }
  it('lists delivered-or-later Barro jobs nobody has rated, newest first, with Rate buttons — and says what it leaves out', async () => {
    const { $ } = await screen();
    const t = plain($('sk-waiting').innerHTML);
    assert.ok(t.includes('Jobs waiting for a rating (2)'), t);
    assert.ok(t.indexOf('Beta <b>Bakery</b>') < t.indexOf('Acme Foods'), 'newest activity first');
    assert.ok(t.includes('JP-2611-002 · BK-2 · Completed') && t.includes('JP-2611-001 · BK-1 · Delivered'));
    assert.ok(!t.includes('Still Building') && !t.includes('Steel Client') && !t.includes('Gamma Hotel') && !t.includes('Cancelled Co'));
    assert.ok(t.includes('Brilliance Steel jobs are not listed'));
    assert.equal($('sk-waiting').querySelectorAll('.sk-rate').length, 2);
  });
  it('escapes the client name in the list and in the button\'s spoken label', async () => {
    const { $ } = await screen();
    const raw = $('sk-waiting').innerHTML;
    assert.ok(!raw.includes('<b>Bakery</b>') && raw.includes('Beta &lt;b&gt;Bakery&lt;/b&gt;') && raw.includes('aria-label="Rate Beta &lt;b&gt;Bakery&lt;/b&gt;"'));
  });
  it('Rate opens that job\'s sheet; saving a rating takes the job off the list and refreshes the scorecard', async () => {
    const seed = baseSeed(); seed.sales_kpi['u-sales'] = cardOn();
    const { env, $ } = await screen(PRES, seed);
    const before = plain($('sk-headline').innerHTML);
    assert.equal(before, 'KPI 58%');
    await $('sk-waiting').querySelectorAll('.sk-rate')[1].click();                // the second row: Acme Foods
    await settle();
    const sheet = env.pages[env.pages.length - 1];
    assert.equal(sheet.title, 'Client rating — Acme Foods');
    await sheet.querySelectorAll('.rt-star')[2].click();                           // 3 stars
    await sheet.querySelector('#rt-save').click();
    await settle();
    assert.equal(env.written()[0].path, 'client_ratings/p1');
    assert.ok(plain($('sk-waiting').innerHTML).includes('Jobs waiting for a rating (1)'));
    // the fake Firestore stamps server time as 1970: move the new rating into November, then reload the scorecard
    env.db.store.client_ratings.get('p1').approvedAt = sec('2026-11-19T04:00:00.000Z');
    await $('sk-staff').fire('change');
    await settle();
    // November now has 2 ratings (5 and 3): 4.0 of 5 = 80%; KPI = 0.7 × 0.4 + 0.3 × 0.8 = 0.52
    assert.equal(plain($('sk-headline').innerHTML), 'KPI 52%');
    assert.equal(plain($('sk-line-rating').innerHTML), 'Client rating: 4.0 of 5 from 2 clients = 80% (counts 30%)');
  });
  it('an empty list says so; a failed read says so with Try again', async () => {
    const seed = baseSeed();
    for (const id of ['p1', 'p2']) seed.client_ratings[id] = { projectId: id, stars: 4, approved: true, company: 'BK', salesUid: 'u-sales' };
    const { $ } = await screen(PRES, seed);
    assert.ok(plain($('sk-waiting').innerHTML).includes('Every delivered job has a rating. Nothing is waiting.'));
    const env = makeEnv(PRES);
    const real = env.db.collection;
    env.db.collection = (c) => (c === 'client_ratings' ? { get: async () => { throw Object.assign(new Error('x'), { code: 'unavailable' }); }, where: () => ({ get: async () => { throw new Error('x'); } }) } : real(c));
    const host = env.dom.host();
    await env.UI.renderScreen(host);
    await settle();
    assert.ok(plain(host.querySelector('#sk-waiting').innerHTML).includes('Could not load the jobs waiting for a rating (unavailable)'));
    assert.ok(host.querySelector('#sk-wretry'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('the engine (js/sales-kpi-core.js) is an app-kit script; a stale shell that lacks it is handled', () => {
  const withoutCore = (who, seed, loader) => {
    const env = makeEnv(who, { seed });
    const loads = [];
    env.load('delete window.SalesKpi', 'as if the shell never listed the core');
    env.ctx.ensureScript = async (src) => { loads.push(src); return loader(env, src); };
    return { env, loads };
  };
  const seedOn = () => { const s = baseSeed(); s.sales_kpi['u-sales'] = cardOn(); return s; };
  it('the screen, My scorecard, the rating row and the sheet each load the core on demand and then work', async () => {
    const load = (env, src) => { assert.equal(src, 'js/sales-kpi-core.js'); env.load(CORE, 'js/sales-kpi-core.js'); };
    const a = withoutCore(PRES, seedOn(), load);
    const host = a.env.dom.host();
    await a.env.UI.renderScreen(host); await settle();
    assert.deepEqual(a.loads, ['js/sales-kpi-core.js']);
    assert.ok(plain(host.innerHTML).includes('KPI 58%'));
    const b = withoutCore(SALES, seedOn(), load);
    const mine = b.env.dom.host();
    await b.env.UI.renderMyScorecard(mine); await settle();
    assert.deepEqual(b.loads, ['js/sales-kpi-core.js']);
    assert.ok(plain(mine.innerHTML).includes('My scorecard'));
    const c = withoutCore(PRES, seedOn(), load);
    const row = c.env.dom.host();
    await c.env.UI.renderJobRating(row, { id: 'p1', stage: 'delivered', company: 'BK' }); await settle();
    assert.deepEqual(c.loads, ['js/sales-kpi-core.js']);
    assert.ok(plain(row.innerHTML).includes('Not rated yet'));
    const d = withoutCore(PRES, seedOn(), load);
    await d.env.UI.openRatingSheet({ id: 'p1', stage: 'delivered', company: 'BK', clientName: 'Acme Foods' });
    assert.equal(d.env.pages.length, 1);
  });
  it('when the core cannot be loaded: the screen says so with Try again, My scorecard shows nothing, the sheet says it could not open', async () => {
    const fail = () => { throw new Error('404'); };
    const a = withoutCore(PRES, seedOn(), fail);
    const host = a.env.dom.host();
    await a.env.UI.renderScreen(host); await settle();
    assert.ok(plain(host.innerHTML).includes('Could not open the Sales KPI (404)'));
    assert.ok(host.querySelector('#sk-retry'));
    const b = withoutCore(SALES, seedOn(), fail);
    const mine = b.env.dom.host();
    await b.env.UI.renderMyScorecard(mine); await settle();
    assert.equal(mine.innerHTML, '');
    const c = withoutCore(PRES, seedOn(), fail);
    await c.env.UI.openRatingSheet({ id: 'p1', stage: 'delivered', company: 'BK' });
    assert.ok(c.env.toastMsgs().some((m) => m.startsWith('Could not open the rating: 404')));
    assert.equal(c.env.pages.length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('display only: the screens write sales_kpi and client_ratings and nothing else', () => {
  it('every write the flows above can make lands on sales_kpi/ or client_ratings/ — never payroll, pay runs, kpi_targets, users, orders, claims or jobs', async () => {
    const seed = baseSeed(); seed.sales_kpi['u-sales'] = cardOn();
    const env = makeEnv(PRES, { seed });
    const host = env.dom.host();
    await env.UI.renderScreen(host);
    await settle();
    host.querySelector('#sk-default').value = '100000';
    await host.querySelector('#sk-save').click();
    await settle();
    await host.querySelector('#sk-waiting').querySelectorAll('.sk-rate')[0].click();
    await settle();
    const sheet = env.pages[env.pages.length - 1];
    await sheet.querySelectorAll('.rt-star')[3].click();
    await sheet.querySelector('#rt-save').click();
    await settle();
    const w = env.written();
    assert.ok(w.length >= 2);
    for (const x of w) assert.ok(/^(sales_kpi|client_ratings)\//.test(x.path), `unexpected write: ${x.op} ${x.path}`);
    assert.equal(env.db.log.filter((l) => l.op === 'add' || l.op === 'delete').length, 0);
  });
  it('viewing a scorecard writes nothing at all', async () => {
    const seed = baseSeed(); seed.sales_kpi['u-sales'] = cardOn();
    for (const who of [PRES, FIN, SALES]) {
      const env = makeEnv(who, { seed });
      const host = env.dom.host();
      await (who === SALES ? env.UI.renderMyScorecard(host) : env.UI.renderScreen(host));
      await settle();
      assert.equal(env.written().length, 0, who.role);
    }
  });
  it('the files name no payroll function or collection (rollout step 6, the pay switch, is a separate change)', () => {
    for (const [name, src] of [['js/sales-kpi-core.js', CORE], ['js/screens/sales-kpi.js', SCREEN]]) {
      const code = stripComments(src);
      for (const banned of ['buildPayRunLines', 'computePayLine', 'computeKpiForMonth', 'kpiBreakdown', 'payBasisSentence', "'payroll'", "'pay_runs'", "'pay_weeks'", "'kpi_targets'", "'kpi_evals'", "'payslips'", "'ledger'"]) {
        assert.ok(!code.includes(banned), `${name} must not reach into payroll or the books (${banned})`);
      }
    }
    // the collections the screens read or write are exactly these
    const colls = [...new Set([...stripComments(SCREEN).matchAll(/collection\('([a-z_]+)'\)/g)].map((m) => m[1]))].sort();
    assert.deepEqual(colls, ['client_ratings', 'job_projects', 'payment_claims', 'sales_kpi', 'sales_orders', 'users']);
  });
  it('the only writes in the screen file are the card (sales_kpi/<uid>) and a rating (client_ratings/<projectId>)', () => {
    const code = stripComments(SCREEN);
    const sites = [...code.matchAll(/([\w'().]+)\.(set|update|delete|add)\(/g)].map((m) => m[1] + '.' + m[2]).filter((x) => !/classList\.add$/.test(x));
    assert.deepEqual(sites, ["fdb.collection('sales_kpi').doc(uid).set", 'ref.update', 'ref.set']);
    assert.equal((code.match(/const ref = fdb\.collection\('client_ratings'\)\.doc\(project\.id\);/g) || []).length, 1, 'ref is the rating document and nothing else');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('no target figure lives in a tracked file (the owner\'s default is typed into the card by the President; the repo is public)', () => {
  it('the core and the screen carry no peso figure and no digit run that could be a target', () => {
    for (const [name, src] of [['js/sales-kpi-core.js', CORE], ['js/screens/sales-kpi.js', SCREEN]]) {
      const runs = [...src.matchAll(/\d{5,}/g)].map((m) => m[0]).filter((x) => x !== '10000');   // 10000 = the 4-decimal rounding factor in the core
      assert.deepEqual(runs, [], `${name} contains a long number`);
      assert.ok(!/\d{1,3}(,\d{3})+/.test(src), `${name} contains a formatted money figure`);
      assert.ok(!/₱\s*\d{2,}/.test(src), `${name} contains a peso figure`);
    }
  });
  it('the card\'s default-target input has no value of its own: it only ever shows what the President typed', () => {
    const m = /<input id="sk-default"[^>]*>/.exec(SCREEN.replace(/' \+ esc\(d\.defaultTarget\) \+ '/g, '@@DRAFT@@'));
    assert.ok(m, 'input not found');
    assert.ok(m[0].includes('value="@@DRAFT@@"') && m[0].includes('placeholder="Not set yet"'));
    assert.ok(!/DEFAULT_TARGET|defaultTarget\s*[:=]\s*['"]?\d/.test(stripComments(SCREEN)), 'no default target constant');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('wiring: where each piece appears (textual pins)', () => {
  const FIN_SRC = read('js/screens/finance.js'), SALES_SRC = read('js/screens/sales.js'), SW = read('sw.js'), INDEX = read('index.html');
  it('Finance › Payroll & HR has a "Sales KPI" member that loads the lazy screen and calls renderSalesKpi', () => {
    assert.ok(FIN_SRC.includes("members:['Payroll','Cash Advances','SSS / Gov','Sales KPI']"));
    assert.ok(FIN_SRC.includes("case 'Sales KPI':"));
    assert.ok(FIN_SRC.includes("await window.ensureScript('js/screens/sales-kpi.js')") && FIN_SRC.includes('await window.renderSalesKpi(content, currentUser, currentRole);'));
  });
  it('the Sales page has the "My scorecard" host right under its header and loads the lazy screen for it', () => {
    assert.ok(SALES_SRC.includes('<div id="sales-scorecard"></div>'));
    assert.ok(SALES_SRC.includes("window.ensureScript('js/screens/sales-kpi.js').then(() => { if (window.SalesKpiUI) window.SalesKpiUI.renderMyScorecard(c.querySelector('#sales-scorecard')); }).catch(() => {});"));
    assert.ok(SALES_SRC.indexOf('<div id="sales-scorecard"></div>') < SALES_SRC.indexOf("window.sopPanel('How Sales works'"));
  });
  it('index.html loads the core in the app-kit after money-core / sales-flow-core and before departments.js; sw.js precaches the core (versioned) and the screen (bare)', () => {
    const kit = INDEX.slice(INDEX.indexOf('<template id="app-kit">'), INDEX.indexOf('</template>'));
    const at = (f) => kit.indexOf(`<script defer src="${f}?v=`);
    assert.ok(at('js/money-core.js') > 0 && at('js/money-core.js') < at('js/sales-flow-core.js') && at('js/sales-flow-core.js') < at('js/sales-kpi-core.js') && at('js/sales-kpi-core.js') < at('js/departments.js'));
    assert.equal((kit.match(/js\/sales-kpi-core\.js/g) || []).length, 1);
    assert.match(SW, /^  '\/js\/sales-kpi-core\.js\?v=\d+\.\d+\.\d+',$/m);
    assert.match(SW, /^  '\/js\/screens\/sales-kpi\.js',$/m);
    assert.equal((INDEX.match(/sales-kpi/g) || []).length, (kit.match(/sales-kpi/g) || []).length, 'never listed outside the app-kit (not in <body>)');
  });
  it('the screen is NOT an app-kit script (lazy only) and the payroll files do not mention it', () => {
    const kit = INDEX.slice(INDEX.indexOf('<template id="app-kit">'), INDEX.indexOf('</template>'));
    assert.ok(!kit.includes('js/screens/sales-kpi.js'));
    for (const f of ['js/money-core.js', 'js/pay-policy.js', 'js/payroll.js', 'js/payroll-weekly.js', 'js/screens/payroll.js']) assert.ok(!/SalesKpi|sales_kpi|sales-kpi/.test(read(f)), `${f} must not know about the Sales KPI yet`);
    assert.ok(!/SalesKpi|sales_kpi|sales-kpi/.test(stripComments(read('js/departments.js'))), 'departments.js (buildPayRunLines) must not know about the Sales KPI yet');
  });
  it('the preview label is exactly "Preview — not yet used for pay"', () => {
    assert.ok(SCREEN.includes("const PREVIEW = 'Preview — not yet used for pay';"));
  });
});
