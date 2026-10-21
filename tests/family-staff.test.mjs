// tests/family-staff.test.mjs — the STAFF side of the configurable product families (owner ruling 2026-10-21):
//
//   * Inventory › Family Pricing (js/screens/family-pricing.js): who may open it, what it shows, that SAVING clears the approval, that APPROVING needs
//     a saved sheet and writes only the approval fields (so the Firestore rule "figures unchanged while approved" holds), that Unapprove really
//     un-approves, that the president-only IMPORT of the private seed is strict (known family, cell the family really has, finite numbers within the
//     cap, nothing prototype-ish) and writes UNAPPROVED sheets only, and that every value shown is HTML-escaped.
//   * Sales › Quote requests (js/screens/quote-requests.js): a configured line shows the family name, each chosen option and the size; the exact figure and
//     how it was built are staff-only (never in the client copy); "Open in Quote Builder" maps the line to its primary SKU with the configuration in
//     the description; a fixed line is mapped exactly as before.
//   * firestore.rules `product_pricing`: finance tier only, never public, no partner, approve requires the approver's own uid and unchanged figures, no delete.
//
// The screens run from their REAL source in a vm sandbox with the REAL escHtml (js/modules.js) and the REAL family/pricing libraries loaded inside the same
// context; Firestore is a small in-memory fake that records every write. Fixtures use FAKE odd-figure pesos (the repository is public).
//
// Mutation-tested in scratch copies (see the commit message): Save leaving `approved` true, Approve writing the figures, Approve not blocked when dirty,
// import accepting an unknown cell / a string amount / a figure over the cap / writing approved sheets, the gate letting the secretary or a partner in,
// an unescaped derivation note, the client copy showing the family breakdown, the builder mapping losing priceManual, and so on; each must fail here.
//
// Run with: node --test tests/*.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const escSrc = read('js/modules.js').match(/function escHtml\(str\) \{[\s\S]*?\n\}/)[0];

const FAKE_SCHEMA = (() => { const m = read('js/qr-families.js').match(/"version":\s*(\d+)/); return m ? Number(m[1]) : 1; })();
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); };
const unesc = (s) => String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// ══════════════════════════════════ Inventory › Family Pricing ══════════════════════════════════
function makeEnv(opts) {
  opts = opts || {};
  const role = opts.role === undefined ? 'president' : opts.role;
  const store = new Map();
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  for (const [id, d] of Object.entries(opts.docs || {})) store.set('product_pricing/' + id, clone(d));
  for (const [id, d] of Object.entries(opts.products || {})) store.set('products/' + id, clone(d));
  store.set('productMeta/config', { constants: opts.constants || {} });
  const writes = [], reads = [], toasts = [], audits = [], confirms = [];
  const stamp = (v) => (v && v.__serverTimestamp ? { _ts: 1 } : v);
  const resolveStamps = (o) => { const out = {}; for (const k of Object.keys(o)) out[k] = (o[k] && o[k].__serverTimestamp) ? { _ts: 1 } : clone(o[k]); return out; };
  const db = {
    // a minimal transaction: reads see the store, an update / set is applied (and recorded) like any other write; a throw in the body aborts the whole thing
    runTransaction: async (fn) => {
      const staged = [];
      const tx = { get: (ref) => ref.get(), update: (ref, patch) => { staged.push([ref, patch, 'update']); }, set: (ref, body) => { staged.push([ref, body, 'set']); } };
      const out = await fn(tx);
      for (const [ref, body, kind] of staged) await (kind === 'set' ? ref.set(body) : ref.update(body));
      return out;
    },
    collection: (name) => ({
      limit: () => ({ get: async () => { reads.push(name); return { docs: [...store.keys()].filter((k) => k.startsWith(name + '/')).map((k) => ({ id: k.split('/')[1], data: () => clone(store.get(k)) })) }; } }),
      doc: (id) => {
        const key = name + '/' + id;
        return {
          get: async () => { reads.push(key); return { exists: store.has(key), id, data: () => clone(store.get(key)) }; },
          set: async (body) => { writes.push({ op: 'set', path: key, body: resolveStamps(body), raw: body }); store.set(key, resolveStamps(body)); },
          update: async (patch) => { writes.push({ op: 'update', path: key, patch: resolveStamps(patch), raw: patch }); if (!store.has(key)) throw new Error('No document to update'); store.set(key, Object.assign({}, store.get(key), resolveStamps(patch))); },
        };
      },
    }),
  };
  const win = {
    currentRole: role, currentDepts: opts.depts || [], currentUser: { uid: 'u-staff', email: 'staff@example.test' }, userProfile: { displayName: 'Fake Approver' },
    renderEmptyState: (o) => `<div class="empty">${o.title}</div>`, skeletonHtml: () => '<div class="skeleton"></div>',
    sopPanel: (t, lines) => `<div class="sop">${t}${lines.length}</div>`,
    confirmDialog: async (o) => { confirms.push(o); return opts.confirm === undefined ? true : opts.confirm; },
    logAudit: (...a) => { audits.push(a); },
  };
  const ctx = vm.createContext({
    window: win, db, console, setTimeout, clearTimeout,
    firebase: { firestore: { FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) } } },
    Notifs: { showToast: (m, t) => toasts.push({ m, t }) },
    emojiIcon: (g) => `[${g}]`, deptContainer: () => null,
  });
  vm.runInContext(escSrc, ctx);
  for (const f of ['js/qr-families.js', 'js/product-families.js', 'js/pricing-core.js', 'js/screens/family-pricing.js']) vm.runInContext(read(f), ctx, { filename: f });
  // a fake container that remembers its markup and the delegated listeners, and answers the few selectors the screen uses
  const stubs = { inputs: {}, notes: {}, approveBtn: {}, tryBox: {} };
  const el = {
    innerHTML: '', _listeners: {},
    addEventListener(t, f) { this._listeners[t] = f; }, removeEventListener(t) { delete this._listeners[t]; },
    contains() { return true; },
    querySelector(sel) {
      let m;
      if ((m = sel.match(/^\.fp-card\[data-fid="([a-z_]+)"\] \[data-act="approve"\]$/))) return stubs.approveBtn[m[1]] || (stubs.approveBtn[m[1]] = { disabled: false });
      if ((m = sel.match(/^\.fp-card\[data-fid="([a-z_]+)"\]$/))) return { querySelectorAll: () => stubs.inputs[m[1]] || [] };
      if ((m = sel.match(/^\.fp-notes\[data-fid="([a-z_]+)"\]$/))) return stubs.notes[m[1]] || null;
      if ((m = sel.match(/^\.fp-try\[data-fid="([a-z_]+)"\]$/))) return stubs.tryBox[m[1]] || null;
      if (sel === '[data-role="import-file"]') return { click() { stubs.importClicked = true; } };
      return null;
    },
  };
  return { ctx, win, el, db, store, writes, reads, toasts, audits, confirms, stubs, clone };
}

// Read the inputs the screen rendered for one family (what the user would see), as editable stubs.
function inputsFromHtml(html, fid) {
  const start = html.indexOf(`data-fid="${fid}" style="margin-bottom:12px"`);
  assert.ok(start >= 0, `family card ${fid} not rendered`);
  const next = html.indexOf('<div class="card fp-card"', start + 10);
  const card = html.slice(start, next < 0 ? html.length : next);
  const out = [];
  for (const m of card.matchAll(/<input type="number"[^>]*class="fp-in"[^>]*>/g)) {
    const attrs = {};
    for (const a of m[0].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[a[1]] = unesc(a[2]);
    out.push({
      attrs, value: attrs.value === undefined ? '' : attrs.value,
      getAttribute(n) { return this.attrs[n]; }, setAttribute(n, v) { this.attrs[n] = String(v); }, removeAttribute(n) { delete this.attrs[n]; },
    });
  }
  return out;
}
const btn = (act, fid) => ({ disabled: false, getAttribute: (a) => ({ 'data-act': act, 'data-fid': fid })[a], closest() { return this; } });
const click = (env, act, fid) => env.el._listeners.click({ target: { closest: () => btn(act, fid) } });

const OK_SHEET = {
  familyId: 'sink', schemaVersion: FAKE_SCHEMA, approved: false, approvedBy: null, approvedByName: null, approvedAt: null, notes: 'a note for finance',
  options: { basins: { 2: { flat: 4300, perW100: null, confidence: 'medium', derivation: 'from the sink-table adder' }, 3: { flat: null, perW100: null, confidence: 'blank', derivation: 'no clean comparison' } }, faucet: { prerinse: { flat: 640, perW100: 15, confidence: 'high', derivation: 'two adders agree' } } },
  size: { perW100: null, confidence: 'blank', derivation: '' },
};

describe('Inventory › Family Pricing — the gate mirrors firestore.rules: president / manager / finance, or a non-secretary Finance member; never a partner or the secretary', () => {
  const can = (role, depts) => makeEnv({ role, depts }).ctx.window.FamilyPricing.canEdit();
  it('allows exactly the money tier and Finance-department members', () => {
    for (const r of ['president', 'manager', 'finance']) assert.equal(can(r, []), true, r);
    assert.equal(can('employee', ['Finance']), true);
    assert.equal(can('agent', ['Sales', 'Finance']), true);
  });
  it('refuses everyone else — including a partner or the secretary who is ALSO listed in Finance', () => {
    assert.equal(can('employee', []), false);
    assert.equal(can('employee', ['Sales', 'IT']), false);
    assert.equal(can('agent', []), false);
    assert.equal(can('partner', []), false);
    assert.equal(can('partner', ['Finance']), false);
    assert.equal(can('secretary', ['Finance']), false);
    assert.equal(can('secretary', []), false);
    assert.equal(can('', []), false);
    assert.equal(can(null, null), false);
  });
  it('only the president is offered the import', () => {
    assert.equal(makeEnv({ role: 'president' }).ctx.window.FamilyPricing.isPresident(), true);
    for (const r of ['manager', 'finance', 'employee', 'partner', 'secretary', '']) assert.equal(makeEnv({ role: r }).ctx.window.FamilyPricing.isPresident(), false, r);
  });
  it('an unauthorised user sees a locked message and the screen never reads Firestore', async () => {
    for (const [role, depts] of [['employee', ['Sales']], ['partner', ['Finance']], ['secretary', ['Finance']]]) {
      const env = makeEnv({ role, depts, docs: { sink: OK_SHEET } });
      await env.ctx.window.renderFamilyPricing(env.el, env.win.currentUser, role);
      assert.match(env.el.innerHTML, /Family pricing is for Finance and the President/);
      assert.ok(!/fp-card/.test(env.el.innerHTML), `${role}: no family card may render`);
      assert.deepEqual(env.reads, [], `${role}: nothing may be read`);
    }
  });
  it('a hand-called save / approve / unapprove by an unauthorised user writes nothing (the buttons are not the only guard)', async () => {
    const env = makeEnv({ role: 'president', docs: { sink: OK_SHEET } });
    await env.ctx.window.renderFamilyPricing(env.el, env.win.currentUser, 'president');
    env.win.currentRole = 'employee'; env.win.currentDepts = ['Sales'];
    for (const act of ['save', 'approve', 'unapprove']) { await click(env, act, 'sink'); await flush(); }
    assert.deepEqual(env.writes, []);
  });
});

describe('Inventory › Family Pricing — what the screen shows', () => {
  it('six family cards in the family order, each with a status: Not set up / Draft / Approved / Out of date; Approve is disabled until a sheet exists', async () => {
    const approved = Object.assign({}, OK_SHEET, { familyId: 'prep_table', approved: true, approvedBy: 'u-1', approvedByName: 'Someone' });
    const stale = Object.assign({}, OK_SHEET, { familyId: 'stove', approved: true, approvedBy: 'u-1', schemaVersion: FAKE_SCHEMA + 5 });
    const env = makeEnv({ docs: { prep_table: approved, sink: OK_SHEET, stove: stale } });
    await env.ctx.window.renderFamilyPricing(env.el, env.win.currentUser, 'president');
    const html = env.el.innerHTML;
    const order = [...html.matchAll(/class="card fp-card" data-fid="([a-z_]+)"/g)].map((m) => m[1]);
    assert.deepEqual(order, ['prep_table', 'sink', 'stove', 'cabinet', 'wall_shelf', 'rack']);
    const cardOf = (fid) => { const a = html.indexOf(`data-fid="${fid}" style="margin-bottom:12px"`); const b = html.indexOf('<div class="card fp-card"', a + 10); return html.slice(a, b < 0 ? html.length : b); };
    assert.match(cardOf('prep_table'), /Approved/);
    assert.match(cardOf('prep_table'), /approved by Someone/);
    assert.match(cardOf('prep_table'), /data-act="unapprove"/);
    assert.match(cardOf('sink'), /Draft — not approved/);
    assert.match(cardOf('sink'), /data-act="approve"[^>]*data-fid="sink"(?![^>]*disabled)/);
    assert.match(cardOf('stove'), /Out of date — approve again/);
    assert.match(cardOf('stove'), /data-act="approve"/, 'an out-of-date sheet needs a fresh approval');
    for (const fid of ['cabinet', 'wall_shelf', 'rack']) {
      assert.match(cardOf(fid), /Not set up/);
      assert.match(cardOf(fid), /data-act="approve"[^>]*disabled/, `${fid}: there is nothing to approve`);
    }
    assert.match(html, /data-act="import"/, 'the president sees the import');
    // amounts entered: "N of M amounts entered"
    assert.match(cardOf('sink'), /2 of \d+ amounts entered/);
  });
  it('a finance user sees the screen but NOT the import button', async () => {
    const env = makeEnv({ role: 'finance' });
    await env.ctx.window.renderFamilyPricing(env.el, env.win.currentUser, 'finance');
    assert.match(env.el.innerHTML, /fp-card/);
    assert.ok(!/data-act="import"/.test(env.el.innerHTML));
  });
  it('an open card lists EVERY option the family has, the standard one as "adds nothing", the length rate only for the linear family, with the derivation note', async () => {
    const env = makeEnv({ docs: { sink: OK_SHEET } });
    await env.ctx.window.renderFamilyPricing(env.el, env.win.currentUser, 'president');
    await click(env, 'toggle', 'sink'); await flush();
    const inputs = inputsFromHtml(env.el.innerHTML, 'sink');
    const PF = env.ctx.window.ProductFamilies, fam = env.ctx.window.QR_FAMILIES.families.sink;
    const cells = PF.cells(fam).filter((c) => !c.baseline);
    assert.equal(inputs.length, cells.length * 2, 'one amount box and one per-100-mm box for every non-standard option');
    assert.match(env.el.innerHTML, /Standard option — adds nothing/);
    assert.match(env.el.innerHTML, /from the sink-table adder/);
    assert.match(env.el.innerHTML, /Try a configuration/);
    assert.ok(!/Per 100 mm from the standard length \(both directions\)/.test(env.el.innerHTML), 'the sink prices its own length: no length-rate row');
    await click(env, 'toggle', 'wall_shelf'); await flush();
    assert.match(env.el.innerHTML, /Per 100 mm from the standard length \(both directions\)/, 'the wall shelving has a length rate row');
    const wall = inputsFromHtml(env.el.innerHTML, 'wall_shelf');
    assert.ok(wall.some((i) => i.attrs['data-g'] === 'size' && i.attrs['data-k'] === 'perW100'));
    // the saved amounts are what the boxes hold
    const b2 = inputs.find((i) => i.attrs['data-g'] === 'basins' && i.attrs['data-v'] === '2' && i.attrs['data-k'] === 'flat');
    assert.equal(b2.value, '4300');
    const b3 = inputs.find((i) => i.attrs['data-g'] === 'basins' && i.attrs['data-v'] === '3' && i.attrs['data-k'] === 'flat');
    assert.equal(b3.value, '', 'a blank amount is an EMPTY box, not 0');
  });
  it('the sheets are read ONE PER FAMILY BY ID: stray documents in the collection never crowd a real sheet out of the screen', async () => {
    const docs = { sink: OK_SHEET };
    for (let i = 0; i < 70; i++) docs[`aaa_junk_${String(i).padStart(3, '0')}`] = { approved: true, junk: i };
    const env = makeEnv({ docs });
    await env.ctx.window.renderFamilyPricing(env.el, env.win.currentUser, 'president');
    assert.match(env.el.innerHTML, /Draft — not approved/, 'the real sink sheet is shown despite 70 stray documents sorting before it');
    assert.ok(!env.reads.includes('product_pricing'), 'no collection scan');
    for (const fid of ['prep_table', 'sink', 'stove', 'cabinet', 'wall_shelf', 'rack']) assert.ok(env.reads.includes('product_pricing/' + fid), fid);
  });
  it('everything interpolated is HTML-escaped: a hostile derivation note, family note or approver name cannot become markup', async () => {
    const HOSTILE = '<img src=x onerror=window.__xss=1>"\'></textarea><script>window.__xss=2</script><svg onload=window.__xss=3>';
    const doc = JSON.parse(JSON.stringify(OK_SHEET));
    doc.approved = true; doc.approvedBy = 'u-1'; doc.approvedByName = HOSTILE; doc.notes = HOSTILE;
    doc.options.basins['2'].derivation = HOSTILE;
    doc.options.faucet.prerinse.confidence = HOSTILE;
    const env = makeEnv({ docs: { sink: doc }, products: { 'PW-004': { title: HOSTILE, formulaType: 'fixed', basePrice: 15555, measurement: { W: 500, D: 500, H: 850 } } } });
    await env.ctx.window.renderFamilyPricing(env.el, env.win.currentUser, 'president');
    await click(env, 'toggle', 'sink'); await flush();
    const html = env.el.innerHTML;
    assert.ok(!/<img|<script|<svg/.test(html), 'a hostile string was parsed as markup');
    assert.ok(html.includes('&lt;img src=x onerror=window.__xss=1&gt;'), 'it is shown as text');
  });
});

describe('Inventory › Family Pricing — Save clears the approval; Approve needs a saved sheet and writes only the approval fields', () => {
  const setup = async (docs, o) => {
    const env = makeEnv(Object.assign({ docs }, o || {}));
    await env.ctx.window.renderFamilyPricing(env.el, env.win.currentUser, 'president');
    await click(env, 'toggle', 'sink'); await flush();
    env.stubs.inputs.sink = inputsFromHtml(env.el.innerHTML, 'sink');
    env.stubs.notes.sink = { value: 'notes typed by finance' };
    return env;
  };
  const input = (env, g, v, k) => env.stubs.inputs.sink.find((i) => i.attrs['data-g'] === g && i.attrs['data-v'] === v && i.attrs['data-k'] === k);

  it('Save writes approved:false and clears approvedBy / approvedByName / approvedAt — even for a sheet that was approved', async () => {
    const approved = Object.assign({}, OK_SHEET, { approved: true, approvedBy: 'u-9', approvedByName: 'Old Approver', approvedAt: { _ts: 1 } });
    const env = await setup({ sink: approved });
    input(env, 'basins', '2', 'flat').value = '4500';
    await click(env, 'save', 'sink'); await flush();
    assert.equal(env.writes.length, 1);
    const w = env.writes[0];
    assert.equal(w.op, 'set'); assert.equal(w.path, 'product_pricing/sink');
    assert.equal(w.body.approved, false);
    assert.equal(w.body.approvedBy, null); assert.equal(w.body.approvedByName, null); assert.equal(w.body.approvedAt, null);
    assert.equal(w.body.familyId, 'sink'); assert.equal(w.body.schemaVersion, FAKE_SCHEMA);
    assert.equal(w.body.updatedBy, 'u-staff');
    assert.equal(w.body.notes, 'notes typed by finance');
    assert.equal(w.body.options.basins['2'].flat, 4500);
    assert.equal(w.body.options.basins['2'].confidence, 'entered', 'a figure the user changed is marked "entered"');
    assert.equal(w.body.options.basins['2'].derivation, 'from the sink-table adder', 'the derivation note is kept');
    assert.equal(w.body.options.faucet.prerinse.flat, 640);
    assert.equal(w.body.options.faucet.prerinse.confidence, 'high', 'an untouched figure keeps its confidence');
    assert.equal(w.body.options.faucet.prerinse.perW100, 15);
    // a blank box is saved as null with confidence "blank" — never 0
    assert.equal(w.body.options.basins['3'].flat, null);
    assert.equal(w.body.options.basins['3'].confidence, 'blank');
    // and the screen now shows it as a draft needing a fresh approval
    assert.match(env.el.innerHTML, /Draft — not approved/);
    assert.match(env.toasts.at(-1).m, /approve it again/);
    assert.deepEqual(env.audits.at(-1).slice(0, 3), ['update', 'product_pricing', 'sink']);
  });
  it('Save writes an amount typed into an empty box and clears one that is emptied (null, "blank")', async () => {
    const env = await setup({ sink: OK_SHEET });
    input(env, 'basins', '3', 'flat').value = '9100';
    input(env, 'faucet', 'prerinse', 'flat').value = '';
    await click(env, 'save', 'sink'); await flush();
    const o = env.writes[0].body.options;
    assert.equal(o.basins['3'].flat, 9100); assert.equal(o.basins['3'].confidence, 'entered');
    assert.equal(o.faucet.prerinse.flat, null); assert.equal(o.faucet.prerinse.confidence, 'blank');
    assert.equal(o.faucet.prerinse.perW100, 15, 'the per-100 box is independent of the flat box');
  });
  it('an amount that is not a number, or is beyond the cap, writes NOTHING and flags the box', async () => {
    for (const bad of ['abc', '12e', '1e9', '-1e9', 'Infinity', '--5', '1,5']) {
      const env = await setup({ sink: OK_SHEET });
      input(env, 'basins', '2', 'flat').value = bad;
      await click(env, 'save', 'sink'); await flush();
      assert.deepEqual(env.writes, [], `"${bad}" must not be saved`);
      assert.equal(env.toasts.at(-1).t, 'error');
      assert.equal(input(env, 'basins', '2', 'flat').attrs['aria-invalid'], 'true');
    }
  });
  it('a number box holding text the browser could not read reports an EMPTY value with badInput: that is INVALID, never a silent blank', async () => {
    const env = await setup({ sink: OK_SHEET });
    const box = input(env, 'basins', '2', 'flat');
    box.value = '';                                                   // what a type=number box says when it holds "12,5" or "abc"
    box.validity = { badInput: true };
    await click(env, 'save', 'sink'); await flush();
    assert.deepEqual(env.writes, [], 'the typed amount must not be saved as blank');
    assert.equal(env.toasts.at(-1).t, 'error');
    assert.equal(box.attrs['aria-invalid'], 'true');
    // a genuinely empty box is still a blank
    box.validity = { badInput: false };
    await click(env, 'save', 'sink'); await flush();
    assert.equal(env.writes[0].body.options.basins['2'].flat, null);
  });
  it('Save only overwrites the figures the editor STARTED from: a sheet someone else saved, created or removed meanwhile is NOT overwritten, and the screen shows theirs', async () => {
    const env = await setup({ sink: OK_SHEET });
    input(env, 'basins', '2', 'flat').value = '4500';
    const theirs = JSON.parse(JSON.stringify(OK_SHEET));
    theirs.options.basins['2'].flat = 7777;
    env.store.set('product_pricing/sink', theirs);                     // another user saved while this one was typing
    await click(env, 'save', 'sink'); await flush();
    assert.deepEqual(env.writes, [], 'nothing was overwritten');
    assert.equal(env.store.get('product_pricing/sink').options.basins['2'].flat, 7777);
    assert.equal(env.toasts.at(-1).t, 'error');
    assert.match(env.toasts.at(-1).m, /Someone saved this sheet while you were editing it/);
    assert.match(env.toasts.at(-1).m, /Nothing was saved/);
    const shown = inputsFromHtml(env.el.innerHTML, 'sink').find((i) => i.attrs['data-g'] === 'basins' && i.attrs['data-v'] === '2' && i.attrs['data-k'] === 'flat');
    assert.equal(shown.value, '7777', 'the screen now shows the other person\'s figures');
    assert.ok(!/unsaved changes/.test(env.el.innerHTML), 'the stale edits are gone, not half-kept');
    // saving again from the new baseline works
    env.stubs.inputs.sink = inputsFromHtml(env.el.innerHTML, 'sink');
    input(env, 'basins', '2', 'flat').value = '4500';
    await click(env, 'save', 'sink'); await flush();
    assert.equal(env.writes.length, 1);
    assert.equal(env.store.get('product_pricing/sink').options.basins['2'].flat, 4500);
    // a sheet CREATED by someone else while this one started from "not set up"
    const env2 = makeEnv({});
    await env2.ctx.window.renderFamilyPricing(env2.el, env2.win.currentUser, 'president');
    await click(env2, 'toggle', 'sink'); await flush();
    env2.stubs.inputs.sink = inputsFromHtml(env2.el.innerHTML, 'sink');
    env2.stubs.inputs.sink[0].value = '100';
    env2.store.set('product_pricing/sink', JSON.parse(JSON.stringify(OK_SHEET)));
    await click(env2, 'save', 'sink'); await flush();
    assert.deepEqual(env2.writes, []);
    // and a sheet REMOVED meanwhile is not silently recreated from an old view
    const env3 = await setup({ sink: OK_SHEET });
    input(env3, 'basins', '2', 'flat').value = '4500';
    env3.store.delete('product_pricing/sink');
    await click(env3, 'save', 'sink'); await flush();
    assert.deepEqual(env3.writes, []);
    assert.ok(!env3.store.has('product_pricing/sink'));
  });
  it('a change that is not to the figures (who saved it, the note) does not block a save', async () => {
    const env = await setup({ sink: OK_SHEET });
    const same = JSON.parse(JSON.stringify(OK_SHEET)); same.notes = 'edited by someone else'; same.updatedByName = 'Other';
    env.store.set('product_pricing/sink', same);
    input(env, 'basins', '2', 'flat').value = '4500';
    await click(env, 'save', 'sink'); await flush();
    assert.equal(env.writes.length, 1);
    assert.equal(env.store.get('product_pricing/sink').options.basins['2'].flat, 4500);
  });
  it('typed-but-unsaved amounts SURVIVE a repaint (opening or closing another card), still flag "unsaved changes", and keep Approve disabled', async () => {
    const env = await setup({ sink: OK_SHEET });
    const box = input(env, 'basins', '3', 'flat');
    box.value = '9100';
    env.el._listeners.input({ target: { classList: { contains: (c) => c === 'fp-in' }, getAttribute: (n) => box.attrs[n], value: '9100' } });
    env.el._listeners.input({ target: { classList: { contains: (c) => c === 'fp-notes' }, getAttribute: () => 'sink', value: 'a half-written note' } });
    await click(env, 'toggle', 'stove'); await flush();               // repaints the whole screen
    const again = inputsFromHtml(env.el.innerHTML, 'sink').find((i) => i.attrs['data-g'] === 'basins' && i.attrs['data-v'] === '3' && i.attrs['data-k'] === 'flat');
    assert.equal(again.value, '9100', 'the typed amount is still in the box');
    assert.match(env.el.innerHTML, /half-written note/);
    assert.match(env.el.innerHTML, /unsaved changes/);
    assert.match(env.el.innerHTML, /data-act="approve" data-fid="sink" disabled/, 'Approve stays disabled after a repaint');
    // saving writes what was typed, and afterwards nothing is held back
    env.stubs.inputs.sink = inputsFromHtml(env.el.innerHTML, 'sink');
    env.stubs.notes.sink = { value: 'a half-written note' };
    await click(env, 'save', 'sink'); await flush();
    assert.equal(env.writes[0].body.options.basins['3'].flat, 9100);
    assert.ok(!/unsaved changes/.test(env.el.innerHTML));
    const saved = inputsFromHtml(env.el.innerHTML, 'sink').find((i) => i.attrs['data-g'] === 'basins' && i.attrs['data-v'] === '3' && i.attrs['data-k'] === 'flat');
    assert.equal(saved.value, '9100');
  });
  it('Refresh drops every unsaved edit and shows what is stored (the typed amounts AND the typed note)', async () => {
    const env = await setup({ sink: OK_SHEET });
    const box = input(env, 'basins', '3', 'flat');
    env.el._listeners.input({ target: { classList: { contains: (c) => c === 'fp-in' }, getAttribute: (n) => box.attrs[n], value: '9100' } });
    env.el._listeners.input({ target: { classList: { contains: (c) => c === 'fp-notes' }, getAttribute: () => 'sink', value: 'typed note' } });
    await click(env, 'reload', ''); await flush();
    assert.ok(!/unsaved changes/.test(env.el.innerHTML));
    assert.ok(!/typed note/.test(env.el.innerHTML), 'the stored note is shown again');
    const shown = inputsFromHtml(env.el.innerHTML, 'sink').find((i) => i.attrs['data-g'] === 'basins' && i.attrs['data-v'] === '3' && i.attrs['data-k'] === 'flat');
    assert.equal(shown.value, '');
  });
  it('negative amounts are allowed (an option can be cheaper than the standard one) and a decimal is kept exactly as typed', async () => {
    const env = await setup({ sink: OK_SHEET });
    input(env, 'basins', '3', 'flat').value = '-450';
    input(env, 'basins', '2', 'perW100').value = '12.5';
    await click(env, 'save', 'sink'); await flush();
    assert.equal(env.writes[0].body.options.basins['3'].flat, -450);
    assert.equal(env.writes[0].body.options.basins['2'].perW100, 12.5);
  });
  it('Approve is BLOCKED while there are unsaved edits (nothing is written, the user is told to save first)', async () => {
    const env = await setup({ sink: OK_SHEET });
    env.el._listeners.input({ target: { classList: { contains: (c) => c === 'fp-in' }, getAttribute: () => 'sink', value: '1' } });
    assert.equal(env.stubs.approveBtn.sink.disabled, true, 'the Approve button is disabled the moment a box is edited');
    await click(env, 'approve', 'sink'); await flush();
    assert.deepEqual(env.writes, []);
    assert.match(env.toasts.at(-1).m, /Save your changes first/);
    assert.equal(env.confirms.length, 0, 'no confirmation is even asked');
  });
  it('Approve asks for confirmation (naming how many options still have no amount); declining writes nothing', async () => {
    const env = await setup({ sink: OK_SHEET }, { confirm: false });
    await click(env, 'approve', 'sink'); await flush();
    assert.equal(env.confirms.length, 1);
    assert.match(env.confirms[0].title, /Approve Sink pricing\?/);
    assert.match(env.confirms[0].message, /\d+ options? (has|have) no amount yet/);
    assert.match(env.confirms[0].message, /priced after review/);
    assert.deepEqual(env.writes, []);
  });
  it('Approve writes ONLY the approval fields — never the figures — and names the approver (what the Firestore rule requires)', async () => {
    const env = await setup({ sink: OK_SHEET });
    await click(env, 'approve', 'sink'); await flush();
    assert.equal(env.writes.length, 1);
    const w = env.writes[0];
    assert.equal(w.op, 'update'); assert.equal(w.path, 'product_pricing/sink');
    assert.deepEqual(Object.keys(w.patch).sort(), ['approved', 'approvedAt', 'approvedBy', 'approvedByName', 'schemaVersion', 'updatedAt', 'updatedBy', 'updatedByName']);
    assert.equal(w.patch.approved, true);
    assert.equal(w.patch.approvedBy, 'u-staff', 'approvedBy must equal the signed-in uid (the rule)');
    assert.equal(w.patch.approvedByName, 'Fake Approver');
    assert.equal(w.patch.schemaVersion, FAKE_SCHEMA);
    assert.ok(!('options' in w.patch) && !('size' in w.patch), 'the figures must be untouched by an approval');
    assert.match(env.el.innerHTML, /Approved/);
    assert.match(env.toasts.at(-1).m, /Sink pricing approved/);
    // the stored sheet is exactly the saved one plus the approval
    const stored = env.store.get('product_pricing/sink');
    assert.deepEqual(stored.options, OK_SHEET.options);
    assert.equal(stored.approved, true);
  });
  it('Approve only approves the figures the approver was LOOKING AT: a sheet someone else saved (or removed) meanwhile is NOT approved, and the screen shows the new figures', async () => {
    const env = await setup({ sink: OK_SHEET });
    // meanwhile another user saves new figures (the store changes; this screen still shows the old ones)
    const changed = JSON.parse(JSON.stringify(OK_SHEET));
    changed.options.basins['2'].flat = 9999;
    env.store.set('product_pricing/sink', changed);
    await click(env, 'approve', 'sink'); await flush();
    assert.deepEqual(env.writes, [], 'nothing was approved');
    assert.equal(env.store.get('product_pricing/sink').approved, false);
    assert.match(env.toasts.at(-1).m, /Someone changed this sheet/);
    assert.equal(env.toasts.at(-1).t, 'error');
    // the screen now shows the NEW figures, open, so the approver can check them
    const shown = inputsFromHtml(env.el.innerHTML, 'sink').find((i) => i.attrs['data-g'] === 'basins' && i.attrs['data-v'] === '2' && i.attrs['data-k'] === 'flat');
    assert.equal(shown.value, '9999');
    // and approving again, now that the figures are the ones on screen, works
    env.stubs.inputs.sink = inputsFromHtml(env.el.innerHTML, 'sink');
    await click(env, 'approve', 'sink'); await flush();
    assert.equal(env.writes.length, 1);
    assert.equal(env.store.get('product_pricing/sink').approved, true);
    assert.equal(env.store.get('product_pricing/sink').options.basins['2'].flat, 9999);
    // a sheet that was deleted meanwhile is not recreated by an approval
    const env2 = await setup({ sink: OK_SHEET });
    env2.store.delete('product_pricing/sink');
    await click(env2, 'approve', 'sink'); await flush();
    assert.deepEqual(env2.writes, []);
    assert.ok(!env2.store.has('product_pricing/sink'));
  });
  it('a change that is NOT to the figures (the notes, who saved it) does not block an approval', async () => {
    const env = await setup({ sink: OK_SHEET });
    const same = JSON.parse(JSON.stringify(OK_SHEET)); same.notes = 'edited by someone else'; same.updatedByName = 'Other';
    env.store.set('product_pricing/sink', same);
    await click(env, 'approve', 'sink'); await flush();
    assert.equal(env.store.get('product_pricing/sink').approved, true);
  });
  it('Approve of a sheet that does not exist yet is a no-op error from the store (the button is disabled in that case anyway), never a created approved sheet', async () => {
    const env = makeEnv({});
    await env.ctx.window.renderFamilyPricing(env.el, env.win.currentUser, 'president');
    await click(env, 'approve', 'cabinet'); await flush();
    assert.ok(!env.store.has('product_pricing/cabinet'));
  });
  it('Unapprove (confirmed) clears the approval and leaves the figures alone; declining writes nothing', async () => {
    const approved = Object.assign({}, OK_SHEET, { approved: true, approvedBy: 'u-9', approvedByName: 'X' });
    const no = await setup({ sink: approved }, { confirm: false });
    await click(no, 'unapprove', 'sink'); await flush();
    assert.deepEqual(no.writes, []);
    const env = await setup({ sink: approved });
    await click(env, 'unapprove', 'sink'); await flush();
    assert.equal(env.writes.length, 1);
    const p = env.writes[0].patch;
    assert.equal(p.approved, false); assert.equal(p.approvedBy, null); assert.equal(p.approvedByName, null); assert.equal(p.approvedAt, null);
    assert.ok(!('options' in p) && !('size' in p));
    assert.match(env.el.innerHTML, /Draft — not approved/);
  });
  it('a failed write is reported to the user, the screen stays usable and the stored sheet is unchanged', async () => {
    const env = await setup({ sink: OK_SHEET });
    const realDoc = env.db.collection;                                      // make every write fail from here on
    env.db.collection = (n) => { const c = realDoc(n); return { limit: c.limit, doc: (id) => { const d = c.doc(id); return Object.assign({}, d, { set: async () => { throw new Error('permission-denied'); } }); } }; };
    input(env, 'basins', '2', 'flat').value = '1';
    await click(env, 'save', 'sink'); await flush();
    assert.equal(env.toasts.at(-1).t, 'error');
    assert.match(env.toasts.at(-1).m, /permission-denied/);
    assert.deepEqual(env.store.get('product_pricing/sink').options, OK_SHEET.options);
  });
});

describe('Inventory › Family Pricing — "Try a configuration" prices with the figures CURRENTLY in the form', () => {
  const PRIM = { title: 'Synthetic Sink', formulaType: 'per_length', basePrice: 15555, measurement: { W: 500, D: 500, H: 850 }, formula: { baseLengthMm: 500, pricePerExtraMm: 0, rateW100: 0, rateD100: 0, rateH100: 0 }, specs: [] };
  const setup = async () => {
    const env = makeEnv({ docs: { sink: OK_SHEET }, products: { 'PW-004': PRIM } });
    await env.ctx.window.renderFamilyPricing(env.el, env.win.currentUser, 'president');
    await click(env, 'toggle', 'sink'); await flush();
    env.stubs.inputs.sink = inputsFromHtml(env.el.innerHTML, 'sink');
    const fam = env.ctx.window.QR_FAMILIES.families.sink;
    const ins = {};
    fam.groups.forEach((g) => { ins[g.key] = { value: String(Math.max(0, g.options.findIndex((o) => o.v === g.default))) }; });
    const out = { innerHTML: '' };
    const dims = { W: { value: '500', getAttribute: () => 'W' }, D: { value: '500', getAttribute: () => 'D' }, H: { value: '850', getAttribute: () => 'H' } };
    env.stubs.tryBox.sink = {
      querySelector: (sel) => { const m = sel.match(/^\.fp-try-in\[data-g="(\w+)"\]$/); if (m) return ins[m[1]] || null; if (sel === '.fp-try-out') return out; return null; },
      querySelectorAll: () => Object.values(dims),
    };
    return { env, ins, out, dims, fam };
  };
  it('the standard configuration is the base item alone', async () => {
    const { env, out } = await setup();
    await click(env, 'try', 'sink');
    assert.match(out.innerHTML, /15,555<\/strong> each/);
  });
  it('an option with an amount adds it (signed), using unsaved edits too; an option with a blank amount is "priced after review", never the base alone', async () => {
    const { env, ins, out, dims, fam } = await setup();
    const faucet = fam.groups.find((g) => g.key === 'faucet');
    ins.faucet.value = String(faucet.options.findIndex((o) => o.v === 'prerinse'));
    await click(env, 'try', 'sink');
    assert.match(out.innerHTML, /16,195<\/strong> each/, '15,555 + 640');
    // an unsaved edit in the form is used, not the stored figure
    env.stubs.inputs.sink.find((i) => i.attrs['data-g'] === 'faucet' && i.attrs['data-v'] === 'prerinse' && i.attrs['data-k'] === 'flat').value = '-100';
    await click(env, 'try', 'sink');
    assert.match(out.innerHTML, /15,455<\/strong> each/, 'the form value -100 wins: 15,555 - 100');
    // three sinks has a blank amount
    const basins = fam.groups.find((g) => g.key === 'basins');
    ins.faucet.value = String(faucet.options.findIndex((o) => o.v === faucet.default));
    ins.basins.value = String(basins.options.findIndex((o) => o.v === 3));
    dims.W.value = '1500';
    await click(env, 'try', 'sink');
    assert.match(out.innerHTML, /Priced after review/);
    assert.ok(!/each/.test(out.innerHTML));
  });
  it('an invalid configuration (a size under the width rule) is explained, not priced', async () => {
    const { env, ins, out, fam } = await setup();
    const basins = fam.groups.find((g) => g.key === 'basins');
    ins.basins.value = String(basins.options.findIndex((o) => o.v === 2));
    await click(env, 'try', 'sink');                                    // 2 sinks at the standard 500 mm length
    assert.match(out.innerHTML, /length must be at least/);
  });
  it('a size basis that no longer matches the base item, and a total that is not above zero, are explained rather than priced', async () => {
    const { env, ins, out } = await setup();
    // make the base item look like it has no length rule: the sink family needs a per_length primary
    env.store.set('products/PW-004', { title: 'Synthetic Sink', formulaType: 'fixed', basePrice: 15555, measurement: { W: 500, D: 500, H: 850 }, formula: {}, specs: [] });
    await env.ctx.window.renderFamilyPricing(env.el, env.win.currentUser, 'president');
    await click(env, 'toggle', 'sink'); await flush();
    env.stubs.inputs.sink = inputsFromHtml(env.el.innerHTML, 'sink');
    env.stubs.tryBox.sink = { querySelector: (sel) => { const m = sel.match(/^\.fp-try-in\[data-g="(\w+)"\]$/); if (m) return ins[m[1]] || { value: '0' }; if (sel === '.fp-try-out') return out; return null; }, querySelectorAll: () => [{ value: '500', getAttribute: () => 'W' }, { value: '500', getAttribute: () => 'D' }, { value: '850', getAttribute: () => 'H' }] };
    await click(env, 'try', 'sink');
    assert.match(out.innerHTML, /size basis no longer matches/);
  });
  it('without the base item readable it says so instead of guessing', async () => {
    const env = makeEnv({ docs: { sink: OK_SHEET }, products: {} });
    await env.ctx.window.renderFamilyPricing(env.el, env.win.currentUser, 'president');
    await click(env, 'toggle', 'sink'); await flush();
    const out = { innerHTML: '' };
    env.stubs.tryBox.sink = { querySelector: (sel) => (sel === '.fp-try-out' ? out : { value: '0' }), querySelectorAll: () => [] };
    await click(env, 'try', 'sink');
    assert.match(out.innerHTML, /could not be read/);
  });
});

describe('Inventory › Family Pricing — the one-time import of the private derived seed (president only) is strict and writes UNAPPROVED sheets only', () => {
  const FP = () => makeEnv({}).ctx.window.FamilyPricing;
  const seedOf = (over) => Object.assign({ kind: 'barro-family-pricing-seed', version: 1, schemaVersion: FAKE_SCHEMA, generatedAt: '2026-10-21T00:00:00.000Z', families: {} }, over || {});
  const cell = (flat, extra) => Object.assign({ flat, perW100: null, confidence: 'medium', derivation: 'because' }, extra || {});

  it('refuses anything that is not a seed file of the current schema (with a message the user can act on)', () => {
    const f = FP();
    for (const bad of [null, undefined, 5, 'x', [], {}, { kind: 'other' }, seedOf({ kind: 'nope' }), seedOf({ version: 2 }), seedOf({ families: null }), seedOf({ families: 'x' })]) {
      const r = f.planImport(bad, {});
      assert.ok(r.error, JSON.stringify(bad));
      assert.match(r.error, /not a family pricing seed file/);
    }
    const old = f.planImport(seedOf({ schemaVersion: FAKE_SCHEMA + 3 }), {});
    assert.match(old.error, /older family definition/);
    assert.match(old.error, /Generate it again/);
  });
  it('plans a sheet per family present in the file, with every real cell present, the amounts rounded to whole pesos, and counts of how many have an amount', () => {
    const r = FP().planImport(seedOf({ families: { sink: { options: { basins: { 2: cell(4300.4, { perW100: 12.6 }), 3: cell(null, { confidence: 'blank' }) }, faucet: { prerinse: cell(640, { confidence: 'high' }) } }, size: {} } } }), { sink: {} });
    assert.equal(r.plan.length, 1);
    const p = r.plan[0];
    assert.equal(p.fid, 'sink');
    assert.equal(p.replaces, true, 'an existing sheet is flagged as replaced');
    assert.equal(p.filled, 2);
    assert.ok(p.total >= 8);
    assert.equal(p.options.basins['2'].flat, 4300);
    assert.equal(p.options.basins['2'].perW100, 13);
    assert.equal(p.options.basins['3'].flat, null);
    assert.equal(p.options.basins['3'].confidence, 'blank');
    assert.equal(p.options.faucet.prerinse.confidence, 'high');
    // every cell the family has is there, including the ones the file did not mention (as blanks), and no baseline cell
    const env = makeEnv({}); const PF = env.ctx.window.ProductFamilies, fam = env.ctx.window.QR_FAMILIES.families.sink;
    const want = Array.from(PF.cells(fam).filter((c) => !c.baseline), (c) => `${c.group}|${c.value}`).sort();
    const got = []; Object.keys(p.options).forEach((g) => Object.keys(p.options[g]).forEach((v) => got.push(`${g}|${v}`)));
    assert.deepEqual(got.sort(), want);
    assert.equal(p.options.alignment.left.flat, null);
    assert.equal(p.options.alignment.left.confidence, 'blank');
  });
  it('a value the file gets wrong becomes BLANK, never zero and never carried through: strings, NaN, Infinity, over the cap, wrong types', () => {
    const base = 1e8;
    const hostile = { basins: { 2: cell('4300'), 3: cell(NaN), 4: cell(Infinity) }, faucet: { prerinse: cell(base + 1) } };
    const r = FP().planImport(seedOf({ families: { sink: { options: JSON.parse(JSON.stringify(hostile, (k, v) => (typeof v === 'number' && !isFinite(v) ? null : v))) } } }), {});
    const o = r.plan[0].options;
    for (const [g, v] of [['basins', '2'], ['basins', '3'], ['basins', '4'], ['faucet', 'prerinse']]) {
      assert.equal(o[g][v].flat, null, `${g}.${v}`);
      assert.equal(o[g][v].confidence, 'blank');
    }
    const cap = FP().planImport(seedOf({ families: { sink: { options: { faucet: { prerinse: cell(base) } } } } }), {});
    assert.equal(cap.plan[0].options.faucet.prerinse.flat, base, 'exactly the cap is allowed');
    const neg = FP().planImport(seedOf({ families: { sink: { options: { faucet: { prerinse: cell(-450) } } } } }), {});
    assert.equal(neg.plan[0].options.faucet.prerinse.flat, -450);
    const objs = FP().planImport(seedOf({ families: { sink: { options: { faucet: { prerinse: { flat: { valueOf: () => 5 }, perW100: [1], confidence: {}, derivation: 12 } } } } } }), {});
    assert.equal(objs.plan[0].options.faucet.prerinse.flat, null);
    assert.equal(objs.plan[0].options.faucet.prerinse.derivation, '');
  });
  it('a per-100-mm amount without a flat amount is dropped (a blank cell has nothing to scale)', () => {
    const r = FP().planImport(seedOf({ families: { sink: { options: { faucet: { prerinse: { flat: null, perW100: 50, confidence: 'low', derivation: 'x' } } } } } }), {});
    assert.equal(r.plan[0].options.faucet.prerinse.perW100, null);
    assert.equal(r.plan[0].options.faucet.prerinse.confidence, 'blank');
  });
  it('an unknown family, group or value is IGNORED (counted, never written), including prototype-ish names', () => {
    const r = FP().planImport(seedOf({ families: JSON.parse('{"__proto__":{"options":{}},"constructor":{"options":{}},"toaster":{"options":{}},"sink":{"options":{"basins":{"2":{"flat":4300},"9":{"flat":1},"__proto__":{"flat":1}},"colour":{"red":{"flat":1}},"__proto__":{"x":{"flat":1}}}}}') }), {});
    assert.deepEqual(Array.from(r.plan, (p) => p.fid), ['sink']);
    const o = r.plan[0].options;
    assert.equal(o.basins['2'].flat, 4300);
    assert.ok(!('9' in o.basins) && !('colour' in o));
    assert.ok(r.skipped >= 3, `unknown cells must be counted (got ${r.skipped})`);
    assert.equal(({}).flat, undefined, 'Object.prototype must not be polluted');
    assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, 'options'), false);
  });
  it('confidence is a whitelist; an unknown label becomes "low" for a figure; the derivation note is stripped of control characters and cut at 600', () => {
    const long = 'x'.repeat(700);
    const r = FP().planImport(seedOf({ families: { sink: { options: { faucet: { prerinse: cell(640, { confidence: '<b>sure</b>', derivation: 'a\u0000b\u0007c\n' + long }) } } } } }), {});
    const c = r.plan[0].options.faucet.prerinse;
    assert.equal(c.confidence, 'low');
    assert.ok(!/[\u0000-\u001f]/.test(c.derivation));
    assert.equal(c.derivation.length, 600);
    assert.ok(c.derivation.startsWith('a b c'));
  });
  it('the linear family\'s length rate is read from `size` and validated like any amount; other families get no size rate', () => {
    const r = FP().planImport(seedOf({ families: { wall_shelf: { options: {}, size: { perW100: 370.3, confidence: 'low', derivation: 'proportional' } }, sink: { options: {}, size: { perW100: 99 } } } }), {});
    const wall = r.plan.find((p) => p.fid === 'wall_shelf'), sink = r.plan.find((p) => p.fid === 'sink');
    assert.equal(wall.size.perW100, 370);
    assert.equal(wall.size.confidence, 'low');
    assert.equal(wall.filled, 1);
    assert.equal(sink.size.perW100, null, 'a family that prices its own length has no length rate to import');
    const bad = FP().planImport(seedOf({ families: { wall_shelf: { options: {}, size: { perW100: '370' } } } }), {});
    assert.equal(bad.plan[0].size.perW100, null);
  });

  // — through the screen: confirm, write, unapproved
  const fileOf = (obj) => ({ files: [{ text: async () => (typeof obj === 'string' ? obj : JSON.stringify(obj)) }], value: 'seed.json' });
  it('imports through the screen: the president confirms, then every sheet is written APPROVED:FALSE with no approver, keeping the existing family note', async () => {
    const env = makeEnv({ docs: { sink: Object.assign({}, OK_SHEET, { approved: true, approvedBy: 'u-9', notes: 'keep this' }) } });
    await env.ctx.window.renderFamilyPricing(env.el, env.win.currentUser, 'president');
    const seed = seedOf({ families: { sink: { options: { basins: { 2: cell(4300) } } }, rack: { options: { wheels: { false: cell(-450) } } } } });
    const input = fileOf(seed);
    await env.el._listeners.change({ target: Object.assign(input, { getAttribute: (a) => (a === 'data-role' ? 'import-file' : null) }) });
    await flush();
    assert.equal(env.confirms.length, 1);
    assert.match(env.confirms[0].message, /Sink: 1 of \d+ amounts \(replaces the current sheet\)/);
    assert.match(env.confirms[0].message, /Rack: 1 of \d+ amounts/);
    assert.match(env.confirms[0].message, /UNAPPROVED/);
    assert.equal(input.value, '', 'the file input is cleared so the same file can be picked again');
    assert.deepEqual(env.writes.map((w) => w.path), ['product_pricing/sink', 'product_pricing/rack']);
    for (const w of env.writes) {
      assert.equal(w.op, 'set');
      assert.equal(w.body.approved, false);
      assert.equal(w.body.approvedBy, null); assert.equal(w.body.approvedAt, null); assert.equal(w.body.approvedByName, null);
      assert.equal(w.body.schemaVersion, FAKE_SCHEMA);
      assert.match(w.body.importedFrom, /^derived seed 2026-10-21/);
    }
    assert.equal(env.writes[0].body.notes, 'keep this');
    assert.match(env.el.innerHTML, /Draft — not approved/);
    assert.match(env.toasts.at(-1).m, /Imported 2 sheets/);
  });
  it('declining the confirmation writes nothing; a non-JSON file, a wrong-kind file and an empty plan are refused with a toast', async () => {
    const env = makeEnv({ confirm: false });
    await env.ctx.window.renderFamilyPricing(env.el, env.win.currentUser, 'president');
    const send = async (input) => { await env.el._listeners.change({ target: Object.assign(input, { getAttribute: (a) => (a === 'data-role' ? 'import-file' : null) }) }); await flush(); };
    await send(fileOf(seedOf({ families: { sink: { options: {} } } })));
    assert.deepEqual(env.writes, []);
    await send(fileOf('{ not json'));
    assert.match(env.toasts.at(-1).m, /not valid JSON/);
    await send(fileOf({ kind: 'something-else' }));
    assert.match(env.toasts.at(-1).m, /not a family pricing seed file/);
    await send(fileOf(seedOf({ families: { toaster: {} } })));
    assert.match(env.toasts.at(-1).m, /none of the six families/);
    assert.deepEqual(env.writes, []);
  });
  it('a finance user who somehow triggers the import writes nothing (president only in the UI)', async () => {
    const env = makeEnv({ role: 'finance' });
    await env.ctx.window.renderFamilyPricing(env.el, env.win.currentUser, 'finance');
    const input = fileOf(seedOf({ families: { sink: { options: { basins: { 2: cell(4300) } } } } }));
    await env.el._listeners.change({ target: Object.assign(input, { getAttribute: (a) => (a === 'data-role' ? 'import-file' : null) }) });
    await flush();
    assert.deepEqual(env.writes, []);
    assert.equal(env.confirms.length, 0);
  });
  it('the seed file the derivation script writes imports cleanly (round trip through the real script against a fake master)', async () => {
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    const DERIVE = req('../scripts/derive-family-pricing.js');
    const FAMS = req('../js/qr-families.js');
    const mk = (id, over) => Object.assign({ id, category: 'prep_washing', name: id, formulaType: 'fixed', basePrice: 7000 + id.length, defaultDimensions: { W: 900, D: 600, H: 850 }, formula: {}, specs: [], unit: 'pc' }, over || {});
    const byId = new Map(['PW-001', 'PW-003', 'PW-004', 'CE-001', 'PW-015', 'PW-023', 'PW-010'].map((id, i) => [id, mk(id, { basePrice: 9000 + i * 1111 })]));
    const seed = DERIVE.deriveAll({ fams: FAMS, byId, constants: {}, masterName: 'fake.json' });
    const r = FP().planImport(JSON.parse(JSON.stringify(seed)), {});
    assert.ok(!r.error, r.error);
    assert.equal(r.plan.length, 6);
    assert.equal(r.skipped, 0, 'a seed written by the script contains no cell the app does not know');
    for (const p of r.plan) {
      const fromSeed = seed.families[p.fid];
      for (const g of Object.keys(fromSeed.options)) for (const v of Object.keys(fromSeed.options[g])) {
        const s = fromSeed.options[g][v], c = p.options[g][v];
        assert.equal(c.flat, s.flat, `${p.fid}.${g}.${v} flat`);
        assert.equal(c.confidence, s.confidence);
      }
    }
  });
});

// ══════════════════════════════════ Sales › Quote requests ══════════════════════════════════
describe('Sales › Quote requests — a configured line: options and size for everyone with access, the exact figure and its build-up for staff only', () => {
  const sandbox = (role) => {
    const ctx = vm.createContext({ window: { currentRole: role, currentDepts: [], bizDate: () => '2026-10-21', renderEmptyState: (o) => `<div>${o.title}</div>` }, emojiIcon: (g) => `[${g}]`, console });
    vm.runInContext(escSrc, ctx);
    vm.runInContext(read('js/screens/quote-requests.js'), ctx);
    return ctx;
  };
  const ctx = sandbox('president');
  const HOSTILE = '<img src=x onerror=window.__xss=1>"\'><script>window.__xss=2</script></td><svg onload=window.__xss=3>';

  const famItem = (over) => Object.assign({
    n: 1, kind: 'family', id: 'PW-004', familyId: 'sink', name: 'Sink', cat: 'Washing', unit: 'pc', qty: 2,
    size: { W: 1800, D: 700, H: 900 }, sizeCustom: true,
    specs: [{ label: 'Sinks', value: '2 sinks' }, { label: 'Position', value: 'Centre' }, { label: 'Undershelf', value: 'With undershelf' }, { label: 'Faucet', value: 'Gooseneck' }],
    config: { basins: 2, alignment: 'center', undershelf: true, upper: false, faucet: 'gooseneck' }, note: 'Near the loading door',
  }, over || {});
  const famLine = (over) => Object.assign({ n: 1, id: 'PW-004', kind: 'family', familyId: 'sink', priced: true, unitPrice: 36703, lineTotal: 73406, base: 20000, deltas: [{ key: 'basins|2', amount: 16703 }], missing: [], reason: null }, over || {});
  const docOf = (items, lines) => ({ id: 'QR-261021-AAAAAA', items, internal: { lines, exactTotal: lines.reduce((n, l) => n + (l.lineTotal || 0), 0) } });

  it('the table names the family, flags it Configurable, shows every chosen option, the size (custom) and the note; the catalogue base item is a STAFF detail', () => {
    const html = ctx._qrItemsTableHtml(docOf([famItem()], [famLine()]), false);
    assert.match(html, /<strong>Sink<\/strong> <span class="badge badge-blue">Configurable<\/span>/);
    assert.ok(!/Catalogue base|PW-004/.test(html), 'the client copy must not name the internal base item');
    assert.match(ctx._qrItemsTableHtml(docOf([famItem()], [famLine()]), true), /Catalogue base: <span[^>]*>PW-004<\/span>/);
    for (const t of ['Sinks: 2 sinks', 'Position: Centre', 'Undershelf: With undershelf', 'Faucet: Gooseneck']) assert.ok(html.includes(t), t);
    assert.match(html, /L1800 × W700 × H900 mm/);
    assert.match(html, /badge-amber">custom</);
    assert.match(html, /Near the loading door/);
  });
  it('the CLIENT copy (no prices) carries no figure and no build-up at all', () => {
    const html = ctx._qrItemsTableHtml(docOf([famItem()], [famLine()]), false);
    assert.ok(!/₱|36,703|73,406|20,000|16,703|Unit \(list\)|Base |Catalogue base/.test(html), 'a figure reached the client copy');
  });
  it('the STAFF table shows the unit figure and how it was built: base at this size + the options', () => {
    const html = ctx._qrItemsTableHtml(docOf([famItem()], [famLine()]), true);
    assert.match(html, /₱36,703/);
    assert.match(html, /Base ₱20,000 at this size \+ options ₱16,703/);
    assert.match(html, /Internal total/);
  });
  it('a negative option total reads as a minus; the build-up never shows a negative amount without its sign', () => {
    const html = ctx._qrFamilyLineNoteHtml(famLine({ base: 20000, unitPrice: 19550, deltas: [{ key: 'wheels|false', amount: -450 }] }));
    assert.match(html, /at this size − options ₱450/);
  });
  it('an unpriced configured line says WHY: not approved, a missing amount (naming it), or no base price — never a number', () => {
    const none = (line) => ctx._qrItemsTableHtml(docOf([famItem()], [line]), true);
    const a = none(famLine({ priced: false, unitPrice: 0, lineTotal: 0, reason: 'not_approved' }));
    assert.match(a, /priced on review/); assert.match(a, /option sheet for this product is not approved yet/);
    const b = none(famLine({ priced: false, unitPrice: 0, lineTotal: 0, reason: 'missing_input', missing: ['Sinks: 3 sinks', 'Faucet: pre-rinse'] }));
    assert.match(b, /No amount entered yet for: Sinks: 3 sinks; Faucet: pre-rinse\./);
    const c = none(famLine({ priced: false, unitPrice: 0, lineTotal: 0, reason: 'no_base_price' }));
    assert.match(c, /catalogue base item has no list price/);
    assert.match(ctx._qrFamilyLineNoteHtml(famLine({ priced: false, unitPrice: 0, reason: 'size_basis' })), /size basis no longer matches its base item/);
    assert.match(ctx._qrFamilyLineNoteHtml(famLine({ priced: false, unitPrice: 0, reason: 'no_price' })), /total is not above zero/);
    assert.equal(ctx._qrFamilyLineNoteHtml(famLine({ priced: false, reason: null })), '');
    for (const h of [a, b, c]) assert.ok(!/₱\d/.test(h.slice(h.indexOf('<tbody>'), h.indexOf('</tbody>'))), 'an unpriced line must show no figure');
  });
  it('hostile text anywhere in a configured line (name, option values, note, base id, missing list) is inert', () => {
    const it = famItem({ name: HOSTILE, id: HOSTILE, note: HOSTILE, specs: [{ label: HOSTILE, value: HOSTILE }] });
    const line = famLine({ priced: false, reason: 'missing_input', missing: [HOSTILE], unitPrice: 0, lineTotal: 0 });
    for (const withPrices of [false, true]) {
      const html = ctx._qrItemsTableHtml(docOf([it], [line]), withPrices);
      assert.ok(!/<img|<svg|<script/.test(html), `withPrices=${withPrices}: a visitor-supplied tag was parsed as markup`);
    }
  });
  it('a FIXED line is rendered exactly as before: product id under the name, no Configurable badge, no build-up', () => {
    const fixed = { n: 1, id: 'RF-003', name: 'Chiller', cat: 'Refrigeration', unit: 'pc', qty: 1, size: null, specs: [], note: '' };
    const html = ctx._qrItemsTableHtml(docOf([fixed], [{ n: 1, id: 'RF-003', priced: true, unitPrice: 5000, lineTotal: 5000 }]), true);
    assert.ok(!/Configurable|Catalogue base|Base ₱/.test(html));
    assert.match(html, /font-family:monospace[^>]*>RF-003</);
  });

  describe('Open in Quote Builder', () => {
    it('a configured line lands as its PRIMARY SKU, named "(configured)", with every option in the description and the size; a priced one keeps its figure (priceManual)', () => {
      const out = ctx._qrToBuilderItem(famItem(), famLine());
      assert.equal(out.id, 'PW-004');
      assert.equal(out.name, 'Sink (configured)');
      assert.equal(out.specStr, 'Sinks: 2 sinks, Position: Centre, Undershelf: With undershelf, Faucet: Gooseneck');
      assert.deepEqual(out.specs.map((s) => s.label), ['Sinks', 'Position', 'Undershelf', 'Faucet']);
      assert.equal(out.dims, 'L1800 × W700 × H900 mm');
      assert.equal(out.qty, 2);
      assert.equal(out.unitPrice, 36703);
      assert.equal(out.amount, 73406);
      assert.equal(out.priceManual, true, 'the builder\'s auto-pricer must not replace the configured figure with the bare SKU price');
      assert.equal(out.notes, 'Near the loading door');
      assert.equal(out.formulaType, 'fixed');
    });
    it('an UNPRICED configured line opens as a line staff must price: zero figure, and priceManual so the builder\'s auto-pricer can NOT fill in the bare SKU\'s price', () => {
      const out = ctx._qrToBuilderItem(famItem(), famLine({ priced: false, unitPrice: 0, lineTotal: 0, reason: 'missing_input' }));
      assert.equal(out.unitPrice, 0); assert.equal(out.amount, 0);
      assert.equal(out.priceManual, true);
      assert.equal(out.id, 'PW-004');
      assert.match(out.name, /\(configured\)/);
      const noLine = ctx._qrToBuilderItem(famItem(), null);
      assert.equal(noLine.unitPrice, 0); assert.equal(noLine.priceManual, true);
      for (const reason of ['not_approved', 'size_basis', 'no_price', 'no_base_price']) {
        assert.equal(ctx._qrToBuilderItem(famItem(), famLine({ priced: false, unitPrice: 0, lineTotal: 0, reason })).priceManual, true, reason);
      }
    });
    it('a fixed line is mapped exactly as before: values only in the description, no suffix, never priceManual', () => {
      const fixed = { n: 1, id: 'RF-003', name: 'Chiller', cat: 'Refrigeration', unit: 'pc', qty: 3, size: { W: 1200 }, specs: [{ label: 'Doors', value: 'Two' }], note: 'n' };
      const out = ctx._qrToBuilderItem(fixed, { n: 1, priced: true, unitPrice: 5000, formulaType: 'per_length' });
      assert.equal(out.name, 'Chiller');
      assert.equal(out.specStr, 'Two');
      assert.equal(out.unitPrice, 5000); assert.equal(out.amount, 15000);
      assert.ok(!('priceManual' in out));
      assert.equal(out.formulaType, 'per_length');
      assert.equal(out.dims, 'L1200 mm');
    });
    it('hostile or odd input cannot break the mapping: strings are coerced, qty is a positive integer', () => {
      const out = ctx._qrToBuilderItem(famItem({ qty: '-4', specs: [null, { label: 5, value: undefined }], note: undefined, name: undefined }), famLine({ unitPrice: 'x' }));
      assert.equal(out.qty, 1);
      assert.equal(typeof out.name, 'string');
      assert.equal(out.unitPrice, 0);
      assert.ok(Array.isArray(out.specs));
    });
  });
});

// ══════════════════════════════════ firestore.rules ══════════════════════════════════
describe('firestore.rules › product_pricing — finance tier only, never public, the approver is named, the approved figures cannot change, nothing is deleted', () => {
  const rules = read('firestore.rules');
  const start = rules.indexOf('match /product_pricing/{familyId} {');
  const block = rules.slice(start, rules.indexOf('\n    }\n', start) + 7);
  const allow = (op) => { const m = block.match(new RegExp(`allow ${op}:[\\s\\S]*?;`)); assert.ok(m, `no "allow ${op}" in the product_pricing block`); return m[0]; };

  it('is declared exactly once, inside the documents match, before the catch-all', () => {
    assert.equal((rules.match(/match \/product_pricing\/\{familyId\}/g) || []).length, 1);
    assert.ok(start > 0);
    const catchAll = rules.indexOf('[RN-99]');
    if (catchAll > 0) assert.ok(start < catchAll, 'the product_pricing rule must sit before the catch-all');
    assert.ok(!/match \/product_pricing\/\{[^}]*=\*\*\}/.test(rules));
  });
  it('read / create / update are signed-in, non-partner, senior-admin or finance — and nothing is open to the public or to any signed-in user', () => {
    for (const op of ['read', 'create', 'update']) {
      const rule = allow(op);
      assert.match(rule, /isAuth\(\) && !isPartner\(\) && \(isSeniorAdmin\(\) \|\| canFinance\(\)\)/, op);
      assert.ok(!/if true|if isAuth\(\);|if request\.auth != null;/.test(rule), `${op} must not be open`);
    }
    assert.ok(!/allow (read|get|list|write):\s*if (true|isAuth\(\))\s*;/.test(block));
    assert.ok(!/allow write/.test(block), 'write is spelled out as create + update (no shortcut that would include delete)');
  });
  it('a new sheet starts UNAPPROVED and can only be created under one of the six family ids', () => {
    const rule = allow('create');
    assert.match(rule, /familyId in \['prep_table', 'sink', 'stove', 'cabinet', 'wall_shelf', 'rack'\]/, 'a sheet can only be created under one of the six family ids');
    assert.ok(!/matches\(/.test(rule), 'no free-form id pattern');
    assert.match(rule, /request\.resource\.data\.get\('approved', false\) == false/);
  });
  it('an update that leaves the sheet approved must name the writer as the approver AND leave the figures exactly as they were', () => {
    const rule = allow('update');
    assert.match(rule, /request\.resource\.data\.get\('approved', false\) is bool/, '`approved` must be a real boolean, never a string or a number');
    assert.match(rule, /request\.resource\.data\.get\('approved', false\) != true/);
    assert.match(rule, /request\.resource\.data\.get\('approvedBy', ''\) == request\.auth\.uid/);
    assert.match(rule, /request\.resource\.data\.get\('options', null\) == resource\.data\.get\('options', null\)/);
    assert.match(rule, /request\.resource\.data\.get\('size', null\) == resource\.data\.get\('size', null\)/);
  });
  it('delete is refused for everyone', () => {
    assert.match(allow('delete'), /allow delete: if false;/);
  });
  it('the helpers it relies on keep their meaning: senior admin = president / manager; finance tier = money-tier role or a non-secretary Finance member', () => {
    assert.match(rules, /function isSeniorAdmin\(\) \{ return getRole\(\) in \['president', 'manager'\]; \}/);
    assert.match(rules, /function isMoneyAdmin\(\)\s+\{ return getRole\(\) in \['president', 'manager', 'finance'\]; \}/);
    assert.match(rules, /function canFinance\(\) \{ return isMoneyAdmin\(\) \|\| isFinanceDept\(\); \}/);
    assert.match(rules, /return u\.get\('role', null\) != 'secretary'\s*\n\s*&& \(u\.get\('department', ''\) == 'Finance'/);
  });
  it('the Cloud Functions read the sheets with the admin SDK only — nothing in the public site or the page can name the collection', () => {
    for (const f of ['js/quote-request.js', 'js/catalogue.js', 'js/qr-families.js', 'js/product-families.js', 'js/qr-preview.js', 'catalogue/index.html', 'js/qr-def.js']) {
      assert.ok(!/product_pricing/.test(read(f)), `${f} must not mention the private collection`);
    }
    assert.match(read('functions/index.js'), /collection\('product_pricing'\)/);
  });
});
