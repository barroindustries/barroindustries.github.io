// tests/family-staff.test.mjs — the STAFF side of the configurable product families (owner ruling 2026-10-21):
//
//   * Inventory › Family Pricing (js/screens/family-pricing.js): who may open it, what it shows, that SAVING clears the approval, that APPROVING needs
//     a saved sheet and writes only the approval fields (so the Firestore rule "figures unchanged while approved" holds), that Unapprove really
//     un-approves, that the president-only IMPORT of the private seed is strict (known family, cell the family really has, finite numbers within the
//     cap, nothing prototype-ish) and writes UNAPPROVED sheets only, and that every value shown is HTML-escaped.
//   * Sales › Quote requests (js/screens/quote-requests.js): a configured line shows the family name, each chosen option and the size; the exact figure and
//     how it was built are staff-only (never in the client copy); "Open in Quote Builder" maps the line to its primary SKU with the configuration in
//     the description; a fixed line is mapped exactly as before.
//   * firestore.rules `product_pricing`: finance tier only, never public, needs a users profile, approve requires the approver's own uid and unchanged figures, no delete.
//
// The screens run from their REAL source in a vm sandbox with the REAL escHtml (js/modules.js) and the REAL family/pricing libraries loaded inside the same
// context; Firestore is a small in-memory fake that records every write. Fixtures use FAKE odd-figure pesos (the repository is public).
//
// MUTATION RECORD 2026-10-28 (scratch copies, cf2-ws1-mut/; each must fail here): the group header not saying when a conditional option applies, the "Disabled on the website" chip
// never shown / shown on every card, the switch read from the wrong key, reading the switch losing the material multiplier of the same document.
// 2026-10-28 (CONFIGURATOR-FAMILIES-2-SPEC §6.4, §9): the screen lists ELEVEN families; a conditional option's group header says when it applies ("Only when Type is Fryer"); a family
// listed in productMeta/config families.disabled carries a read-only "Disabled on the website" chip. The families are on schema 4.
// 2026-10-28 (CONFIGURATOR-GRADE-TITLES-SPEC, schema 4): every card lists the staff-only MATERIAL group first — SS304 is the standard (adds nothing), SS316 has one signed amount pair (flat, per 100 mm),
// blank until Finance enters it, the header carries the staff-only caption — and the import brings that cell as typed.
// 2026-10-28 WS-2 (CONFIGURATOR-FAMILIES-2-SPEC §8.1, scratch copy cf2-ws2-mut/, 7 rules mutants, all killed; each must fail here): the rules create list missing "hood" or "dish_table", back to the old six ids, naming a twelfth id nobody
// ships, listing an id twice, opened to any id, or reordered (the literal pin) — the list is pinned both as text and against QR_FAMILIES.order.
//
// Mutation-tested in scratch copies (see the commit message): Save leaving `approved` true, Approve writing the figures, Approve not blocked when dirty,
// import accepting an unknown cell / a string amount / a figure over the cap / writing approved sheets, the gate letting the secretary in, a read that no longer needs a profile,
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
  store.set('productMeta/config', Object.assign({ constants: opts.constants || {} }, opts.meta || {}));
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

describe('Inventory › Family Pricing — the gate mirrors firestore.rules: president / manager / finance, or a non-secretary Finance member; never the secretary', () => {
  const can = (role, depts) => makeEnv({ role, depts }).ctx.window.FamilyPricing.canEdit();
  it('allows exactly the money tier and Finance-department members', () => {
    for (const r of ['president', 'manager', 'finance']) assert.equal(can(r, []), true, r);
    assert.equal(can('employee', ['Finance']), true);
    assert.equal(can('agent', ['Sales', 'Finance']), true);
  });
  it('refuses everyone else — including the secretary who is ALSO listed in Finance', () => {
    assert.equal(can('employee', []), false);
    assert.equal(can('employee', ['Sales', 'IT']), false);
    assert.equal(can('agent', []), false);
    assert.equal(can('secretary', ['Finance']), false);
    assert.equal(can('secretary', []), false);
    assert.equal(can('', []), false);
    assert.equal(can(null, null), false);
  });
  it('only the president is offered the import', () => {
    assert.equal(makeEnv({ role: 'president' }).ctx.window.FamilyPricing.isPresident(), true);
    for (const r of ['manager', 'finance', 'employee', 'secretary', '']) assert.equal(makeEnv({ role: r }).ctx.window.FamilyPricing.isPresident(), false, r);
  });
  it('an unauthorised user sees a locked message and the screen never reads Firestore', async () => {
    for (const [role, depts] of [['employee', ['Sales']], ['secretary', ['Finance']]]) {
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
  it('eleven family cards in the family order, each with a status: Not set up / Draft / Approved / Out of date; Approve is disabled until a sheet exists', async () => {
    const approved = Object.assign({}, OK_SHEET, { familyId: 'prep_table', approved: true, approvedBy: 'u-1', approvedByName: 'Someone' });
    const stale = Object.assign({}, OK_SHEET, { familyId: 'stove', approved: true, approvedBy: 'u-1', schemaVersion: FAKE_SCHEMA + 5 });
    const env = makeEnv({ docs: { prep_table: approved, sink: OK_SHEET, stove: stale } });
    await env.ctx.window.renderFamilyPricing(env.el, env.win.currentUser, 'president');
    const html = env.el.innerHTML;
    const order = [...html.matchAll(/class="card fp-card" data-fid="([a-z_]+)"/g)].map((m) => m[1]);
    assert.deepEqual(order, ['prep_table', 'sink', 'dish_table', 'stove', 'wok_range', 'cooking_line', 'deck_oven', 'hood', 'cabinet', 'wall_shelf', 'rack']);
    const cardOf = (fid) => { const a = html.indexOf(`data-fid="${fid}" style="margin-bottom:12px"`); const b = html.indexOf('<div class="card fp-card"', a + 10); return html.slice(a, b < 0 ? html.length : b); };
    assert.match(cardOf('prep_table'), /Approved/);
    assert.match(cardOf('prep_table'), /approved by Someone/);
    assert.match(cardOf('prep_table'), /data-act="unapprove"/);
    assert.match(cardOf('sink'), /Draft — not approved/);
    assert.match(cardOf('sink'), /data-act="approve"[^>]*data-fid="sink"(?![^>]*disabled)/);
    assert.match(cardOf('stove'), /Out of date — approve again/);
    assert.match(cardOf('stove'), /data-act="approve"/, 'an out-of-date sheet needs a fresh approval');
    for (const fid of ['dish_table', 'wok_range', 'cooking_line', 'deck_oven', 'hood', 'cabinet', 'wall_shelf', 'rack']) {
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
    for (const fid of ['prep_table', 'sink', 'dish_table', 'stove', 'wok_range', 'cooking_line', 'deck_oven', 'hood', 'cabinet', 'wall_shelf', 'rack']) assert.ok(env.reads.includes('product_pricing/' + fid), fid);
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

// ── the staff-only TOP PLATE (owner ruling 2026-10-28, QUOTE-BUILDER-CONFIGURATOR-SPEC §14): tables, sinks and stoves have a 1.5 mm (16 ga) top as the STANDARD and a 1.2 mm top that only
// staff can choose. Its sheet cell is the SIGNED amount added for 1.2 mm (a negative number, or 0); a blank is "priced after review", never zero. The definitions moved to schema 2, so
// every sheet approved against schema 1 reads "Out of date — approve again" until Finance / the President approves it again knowing the base item's list price is the 1.5 mm price.
describe('Inventory › Family Pricing — the staff-only Top plate: its own cells, a staff-only caption, priced in "Try a configuration", and the schema re-approval', () => {
  const WITH_TOP = ['prep_table', 'sink', 'dish_table', 'stove', 'wok_range'];
  const CAPTION = 'Staff-only option — offered in the Quote Builder, never on the website';
  const open = async (fid, docs) => {
    const env = makeEnv({ docs: docs || {} });
    await env.ctx.window.renderFamilyPricing(env.el, env.win.currentUser, 'president');
    await click(env, 'toggle', fid); await flush();
    const html = env.el.innerHTML;
    const a = html.indexOf(`data-fid="${fid}" style="margin-bottom:12px"`);
    const b = html.indexOf('<div class="card fp-card"', a + 10);
    return { env, card: html.slice(a, b < 0 ? html.length : b), inputs: inputsFromHtml(html, fid) };
  };

  it('table, sink, dish table, stove and wok range list a "Top plate" group: the 1.5 mm top is the standard (adds nothing), the 1.2 mm top has its own amount boxes, and the group header says it is staff only', async () => {
    for (const fid of WITH_TOP) {
      const { card, inputs } = await open(fid);
      assert.match(card, /<strong>Top plate<\/strong>/, fid);
      assert.equal(card.split(CAPTION).length - 1, 2, `${fid}: the staff-only caption appears twice — on the Material header and on the Top plate header, nowhere else`);
      assert.match(card, /<strong>Top plate<\/strong>[^]*?Staff-only option — offered in the Quote Builder, never on the website/, `${fid}: the caption belongs to the Top plate header`);
      assert.match(card, /<strong>Material<\/strong>[^]*?Staff-only option — offered in the Quote Builder, never on the website[^]*?<strong>Top plate<\/strong>/, `${fid}: and one to the Material header, ahead of it`);
      assert.match(card, /1\.5 mm \(16 ga\)[^]*?Standard option — adds nothing/, `${fid}: the standard top adds nothing`);
      const top = inputs.filter((i) => i.attrs['data-g'] === 'top');
      assert.deepEqual(top.map((i) => `${i.attrs['data-v']}|${i.attrs['data-k']}`), ['1.2|flat', '1.2|perW100'], `${fid}: boxes for the 1.2 mm top only`);
      assert.equal(top[0].value, '', `${fid}: no amount yet is an EMPTY box, never 0`);
    }
  });
  it('the cooking line, deck oven, hood, cabinet, wall shelving and rack have no Top plate, and their only staff-only caption is the Material header\'s', async () => {
    for (const fid of ['cooking_line', 'deck_oven', 'hood', 'cabinet', 'wall_shelf', 'rack']) {
      const { card, inputs } = await open(fid);
      assert.ok(!/Top plate/.test(card), fid);
      assert.equal(card.split(CAPTION).length - 1, 1, `${fid}: one staff-only caption, on the Material header`);
      assert.match(card, /<strong>Material<\/strong>[^]*?Staff-only option/, fid);
      assert.ok(!inputs.some((i) => i.attrs['data-g'] === 'top'), fid);
    }
  });
  it('the saved 1.2 mm amount fills its box (a negative amount is shown as typed), and "N of M amounts entered" counts the new cell', async () => {
    const sheet = Object.assign({}, OK_SHEET, { options: Object.assign({}, OK_SHEET.options, { top: { 1.2: { flat: -300, perW100: null, confidence: 'entered', derivation: 'typed by Finance' } } }) });
    const { card, inputs } = await open('sink', { sink: sheet });
    assert.equal(inputs.find((i) => i.attrs['data-g'] === 'top' && i.attrs['data-k'] === 'flat').value, '-300');
    // the sink has 10 option cells besides the standard ones — the SS316 grade and the 1.2 mm top are two of them — and 3 of them have an amount
    assert.match(card, /3 of 10 amounts entered/);
    const none = await open('sink', { sink: OK_SHEET });
    assert.match(none.card, /2 of 10 amounts entered/, 'the blank 1.2 mm cell (and the blank SS316 cell) are counted among the amounts still to enter');
  });

  describe('"Try a configuration" prices the staff-only top with the figures in the form', () => {
    const BASE = { title: 'Synthetic Sink', formulaType: 'per_length', basePrice: 15555, measurement: { W: 500, D: 500, H: 850 }, formula: { baseLengthMm: 500, pricePerExtraMm: 0, rateW100: 0, rateD100: 0, rateH100: 0 }, specs: [] };
    const sheetWith = (cell) => Object.assign({}, OK_SHEET, { options: Object.assign({}, OK_SHEET.options, cell === null ? {} : { top: { 1.2: cell } }) });
    const setup = async (sheet) => {
      const env = makeEnv({ docs: { sink: sheet }, products: { 'PW-004': BASE } });
      await env.ctx.window.renderFamilyPricing(env.el, env.win.currentUser, 'president');
      await click(env, 'toggle', 'sink'); await flush();
      env.stubs.inputs.sink = inputsFromHtml(env.el.innerHTML, 'sink');
      const fam = env.ctx.window.QR_FAMILIES.families.sink;
      const ins = {};
      fam.groups.forEach((g) => { ins[g.key] = { value: String(Math.max(0, g.options.findIndex((o) => o.v === g.default))) }; });
      const out = { innerHTML: '' };
      const dims = [{ value: '500', getAttribute: () => 'W' }, { value: '500', getAttribute: () => 'D' }, { value: '850', getAttribute: () => 'H' }];
      env.stubs.tryBox.sink = { querySelector: (sel) => { const m = sel.match(/^\.fp-try-in\[data-g="(\w+)"\]$/); if (m) return ins[m[1]] || null; if (sel === '.fp-try-out') return out; return null; }, querySelectorAll: () => dims };
      const choose = (value) => { ins.top.value = String(fam.groups.find((g) => g.key === 'top').options.findIndex((o) => o.v === value)); };
      return { env, ins, out, choose };
    };
    it('the control lists both top plates, the standard first and selected', async () => {
      const { env } = await setup(sheetWith(null));
      const select = env.el.innerHTML.match(/<select class="fp-try-in" data-g="top"[^>]*>([^]*?)<\/select>/);
      assert.ok(select, 'a Top plate control in the try box');
      assert.deepEqual([...select[1].matchAll(/<option value="(\d)"( selected)?>([^<]*)<\/option>/g)].map((m) => [m[1], !!m[2], unesc(m[3])]),
        [['0', true, '1.5 mm (16 ga) — Standard'], ['1', false, '1.2 mm — Lighter']]);
    });
    it('a NEGATIVE amount lowers the figure by exactly that much and the summary says "1.2 mm top"; 0 keeps the figure; the standard top is the base item alone', async () => {
      const { env, out, choose } = await setup(sheetWith({ flat: -300, perW100: null, confidence: 'entered', derivation: 'x' }));
      choose(1.2);
      await click(env, 'try', 'sink');
      assert.match(out.innerHTML, /15,255<\/strong> each/, '15,555 - 300');
      assert.match(out.innerHTML, /− options ₱300/);
      assert.match(out.innerHTML, /1\.2 mm top/);
      choose(1.5);
      await click(env, 'try', 'sink');
      assert.match(out.innerHTML, /15,555<\/strong> each/, 'the standard top needs no cell');
      assert.ok(!/1\.2 mm top/.test(out.innerHTML));
      // an unsaved edit in the form is used, not the stored figure; an explicit 0 IS a figure
      choose(1.2);
      env.stubs.inputs.sink.find((i) => i.attrs['data-g'] === 'top' && i.attrs['data-v'] === '1.2' && i.attrs['data-k'] === 'flat').value = '0';
      await click(env, 'try', 'sink');
      assert.match(out.innerHTML, /15,555<\/strong> each/);
      assert.ok(!/Priced after review/.test(out.innerHTML), 'zero is a figure, not a blank');
    });
    it('a BLANK 1.2 mm cell is "Priced after review — … Top plate: 1.2 mm", never the base alone', async () => {
      const { env, out, choose } = await setup(sheetWith(null));
      choose(1.2);
      await click(env, 'try', 'sink');
      assert.match(out.innerHTML, /Priced after review — no amount entered yet for: Top plate: 1\.2 mm\./);
      assert.ok(!/each/.test(out.innerHTML));
      assert.ok(!/chosen by our staff/.test(out.innerHTML), 'the screen is a STAFF session: the staff-only top is a valid choice here');
    });
  });

  it('a sheet approved against the OLD definitions (schema 1) reads "Out of date — approve again"; the same sheet at the current schema is Approved', async () => {
    assert.equal(FAKE_SCHEMA, 4, 'the families are on schema 4 (the staff-only steel grade and the line titles on top of the five more families and the 1.5 mm top plate): every sheet must be approved against it');
    const old = Object.assign({}, OK_SHEET, { approved: true, approvedBy: 'u-1', approvedByName: 'Someone', schemaVersion: 1 });
    const env = makeEnv({ docs: { sink: old, prep_table: Object.assign({}, old, { familyId: 'prep_table', schemaVersion: FAKE_SCHEMA }) } });
    await env.ctx.window.renderFamilyPricing(env.el, env.win.currentUser, 'president');
    const html = env.el.innerHTML;
    const cardOf = (fid) => { const a = html.indexOf(`data-fid="${fid}" style="margin-bottom:12px"`); const b = html.indexOf('<div class="card fp-card"', a + 10); return html.slice(a, b < 0 ? html.length : b); };
    assert.match(cardOf('sink'), /Out of date — approve again/);
    assert.match(cardOf('sink'), /data-act="approve"[^>]*data-fid="sink"(?![^>]*disabled)/, 'it can be approved again');
    assert.match(cardOf('prep_table'), /Approved/);
    assert.ok(!/Out of date/.test(cardOf('prep_table')));
  });
  it('the import refuses a seed made for an older schema ("generate it again"); a current-schema seed brings the 1.2 mm cell as typed (negative allowed), a blank stays blank, and a figure for the standard top is ignored', () => {
    const FP = makeEnv({}).ctx.window.FamilyPricing;
    const seed = (schemaVersion, families) => ({ kind: 'barro-family-pricing-seed', version: 1, schemaVersion, generatedAt: '2026-10-28T00:00:00.000Z', families });
    for (const older of [1, 2, 3]) {
      const old = FP.planImport(seed(older, { sink: { options: {} } }), {});
      assert.match(old.error, new RegExp(`older family definition \\(schema ${older}, the app is on ${FAKE_SCHEMA}\\)`));
      assert.match(old.error, /Generate it again/);
    }
    const typed = FP.planImport(seed(FAKE_SCHEMA, { sink: { options: { top: { 1.2: { flat: -300.4, perW100: null, confidence: 'medium', derivation: 'typed' }, 1.5: { flat: 99 } } } } }), {});
    assert.ok(!typed.error, typed.error);
    const top = typed.plan[0].options.top;
    assert.equal(top['1.2'].flat, -300, 'a negative amount is kept (rounded to whole pesos)');
    assert.ok(!('1.5' in top), 'the standard top is the zero point: it has no cell');
    assert.ok(typed.skipped >= 1, 'the figure for the standard top is counted as ignored');
    const blank = FP.planImport(seed(FAKE_SCHEMA, { sink: { options: {} } }), {});
    assert.equal(blank.plan[0].options.top['1.2'].flat, null);
    assert.equal(blank.plan[0].options.top['1.2'].confidence, 'blank');
  });
});

describe('Inventory › Family Pricing — the staff-only steel grade (Material): the first group of every card, one SS316 cell (signed; flat + per 100 mm), schema 4', () => {
  const CAPTION = 'Staff-only option — offered in the Quote Builder, never on the website';
  const ALL = ['prep_table', 'sink', 'dish_table', 'stove', 'wok_range', 'cooking_line', 'deck_oven', 'hood', 'cabinet', 'wall_shelf', 'rack'];
  const open = async (fid, docs) => {
    const env = makeEnv({ docs: docs || {} });
    await env.ctx.window.renderFamilyPricing(env.el, env.win.currentUser, 'president');
    await click(env, 'toggle', fid); await flush();
    const html = env.el.innerHTML;
    const a = html.indexOf(`data-fid="${fid}" style="margin-bottom:12px"`);
    const b = html.indexOf('<div class="card fp-card"', a + 10);
    return { env, card: html.slice(a, b < 0 ? html.length : b), inputs: inputsFromHtml(html, fid) };
  };

  it('EVERY card lists Material FIRST, with the staff-only caption on its header: SS304 is the standard (adds nothing, no boxes), SS316 has its two amount boxes — blank is an EMPTY box, never 0', async () => {
    for (const fid of ALL) {
      const { card, inputs } = await open(fid);
      const firstHeader = card.match(/<tr class="fp-grp"><td[^>]*><strong>([^<]*)<\/strong>/);
      assert.equal(unesc(firstHeader[1]), 'Material', `${fid}: the first group on the card`);
      assert.match(card, /<strong>Material<\/strong>[^]*?Staff-only option — offered in the Quote Builder, never on the website/, fid);
      assert.match(card, /Stainless Steel 304 Food Grade[^]*?Standard option — adds nothing/, `${fid}: SS304 is the zero point`);
      assert.match(card, /Stainless Steel 316 Laboratory Grade/, fid);
      const grade = inputs.filter((i) => i.attrs['data-g'] === 'grade');
      assert.deepEqual(grade.map((i) => `${i.attrs['data-v']}|${i.attrs['data-k']}`), ['316|flat', '316|perW100'], `${fid}: boxes for SS316 only`);
      assert.equal(grade[0].value, '', `${fid}: no amount yet is an EMPTY box`);
      assert.equal(inputs[0].attrs['data-g'], 'grade', `${fid}: the first input on the card is the grade's`);
      assert.ok(card.split(CAPTION).length - 1 >= 1, fid);
    }
  });

  it('a saved SS316 amount fills its box (flat and per 100 mm, as typed) and is counted in "N of M amounts entered"', async () => {
    const sheet = Object.assign({}, OK_SHEET, { options: Object.assign({}, OK_SHEET.options, { grade: { 316: { flat: 4217, perW100: 38, confidence: 'entered', derivation: 'typed by Finance' } } }) });
    const { card, inputs } = await open('sink', { sink: sheet });
    assert.equal(inputs.find((i) => i.attrs['data-g'] === 'grade' && i.attrs['data-k'] === 'flat').value, '4217');
    assert.equal(inputs.find((i) => i.attrs['data-g'] === 'grade' && i.attrs['data-k'] === 'perW100').value, '38');
    assert.match(card, /3 of 10 amounts entered/, 'the three entered amounts of the fixture sheet… ');
    const plain = await open('sink', { sink: OK_SHEET });
    assert.match(plain.card, /2 of 10 amounts entered/, 'and the blank SS316 cell is one still to enter');
  });

  it('the import: a schema-4 seed brings the SS316 cell as typed (a negative or zero figure and the per-100-mm part too), a blank stays blank, a figure for SS304 (the zero point) is ignored, and a schema-3 seed is refused', () => {
    const FP = makeEnv({}).ctx.window.FamilyPricing;
    const seed = (schemaVersion, families) => ({ kind: 'barro-family-pricing-seed', version: 1, schemaVersion, generatedAt: '2026-10-28T00:00:00.000Z', families });
    const typed = FP.planImport(seed(FAKE_SCHEMA, { sink: { options: { grade: { 316: { flat: 4217.4, perW100: 38, confidence: 'medium', derivation: 'typed' }, 304: { flat: 99 } } } } }), {});
    assert.ok(!typed.error, typed.error);
    const grade = typed.plan[0].options.grade;
    assert.equal(grade['316'].flat, 4217, 'rounded to whole pesos');
    assert.equal(grade['316'].perW100, 38);
    assert.ok(!('304' in grade), 'the standard grade is the zero point: it has no cell');
    assert.ok(typed.skipped >= 1, 'the figure for the standard grade is counted as ignored');
    const zero = FP.planImport(seed(FAKE_SCHEMA, { sink: { options: { grade: { 316: { flat: 0, perW100: null, confidence: 'entered', derivation: 'x' } } } } }), {});
    assert.equal(zero.plan[0].options.grade['316'].flat, 0, 'an explicit 0 IS a figure');
    const blank = FP.planImport(seed(FAKE_SCHEMA, { sink: { options: {} } }), {});
    assert.equal(blank.plan[0].options.grade['316'].flat, null);
    assert.equal(blank.plan[0].options.grade['316'].confidence, 'blank');
    const old = FP.planImport(seed(FAKE_SCHEMA - 1, { sink: { options: { grade: { 316: { flat: 4217 } } } } }), {});
    assert.match(old.error, new RegExp(`older family definition \\(schema ${FAKE_SCHEMA - 1}, the app is on ${FAKE_SCHEMA}\\)`));
  });

  describe('"Try a configuration" prices SS316 with the figures in the form', () => {
    const BASE = { title: 'Synthetic Sink', formulaType: 'per_length', basePrice: 15555, measurement: { W: 500, D: 500, H: 850 }, formula: { baseLengthMm: 500, pricePerExtraMm: 0, rateW100: 0, rateD100: 0, rateH100: 0 }, specs: [] };
    const sheetWith = (cell) => Object.assign({}, OK_SHEET, { options: Object.assign({}, OK_SHEET.options, cell === null ? {} : { grade: { 316: cell } }) });
    const setup = async (sheet) => {
      const env = makeEnv({ docs: { sink: sheet }, products: { 'PW-004': BASE } });
      await env.ctx.window.renderFamilyPricing(env.el, env.win.currentUser, 'president');
      await click(env, 'toggle', 'sink'); await flush();
      env.stubs.inputs.sink = inputsFromHtml(env.el.innerHTML, 'sink');
      const fam = env.ctx.window.QR_FAMILIES.families.sink;
      const ins = {};
      fam.groups.forEach((g) => { ins[g.key] = { value: String(Math.max(0, g.options.findIndex((o) => o.v === g.default))) }; });
      const out = { innerHTML: '' };
      const dims = [{ value: '500', getAttribute: () => 'W' }, { value: '500', getAttribute: () => 'D' }, { value: '850', getAttribute: () => 'H' }];
      env.stubs.tryBox.sink = { querySelector: (sel) => { const m = sel.match(/^\.fp-try-in\[data-g="(\w+)"\]$/); if (m) return ins[m[1]] || null; if (sel === '.fp-try-out') return out; return null; }, querySelectorAll: () => dims };
      const choose = (value) => { ins.grade.value = String(fam.groups.find((g) => g.key === 'grade').options.findIndex((o) => o.v === value)); };
      return { env, ins, out, choose };
    };
    it('the control lists both grades, the standard first and selected, in the same box as the other options', async () => {
      const { env } = await setup(sheetWith(null));
      const select = env.el.innerHTML.match(/<select class="fp-try-in" data-g="grade"[^>]*>([^]*?)<\/select>/);
      assert.ok(select, 'a Material control in the try box');
      assert.deepEqual([...select[1].matchAll(/<option value="(\d)"( selected)?>([^<]*)<\/option>/g)].map((m) => [m[1], !!m[2], unesc(m[3])]),
        [['0', true, 'Stainless Steel 304 Food Grade'], ['1', false, 'Stainless Steel 316 Laboratory Grade']]);
    });
    it('a POSITIVE amount raises the figure by exactly that much and the summary says "SS316"; the standard grade is the base item alone; an unsaved edit in the form is used', async () => {
      const { env, out, choose } = await setup(sheetWith({ flat: 4217, perW100: null, confidence: 'entered', derivation: 'x' }));
      choose(316);
      await click(env, 'try', 'sink');
      assert.match(out.innerHTML, /19,772<\/strong> each/, '15,555 + 4,217');
      assert.match(out.innerHTML, /\+ options ₱4,217/);
      assert.match(out.innerHTML, /SS316/);
      choose(304);
      await click(env, 'try', 'sink');
      assert.match(out.innerHTML, /15,555<\/strong> each/, 'the standard grade needs no cell');
      assert.ok(!/SS316/.test(out.innerHTML));
      choose(316);
      env.stubs.inputs.sink.find((i) => i.attrs['data-g'] === 'grade' && i.attrs['data-v'] === '316' && i.attrs['data-k'] === 'flat').value = '0';
      await click(env, 'try', 'sink');
      assert.match(out.innerHTML, /15,555<\/strong> each/, 'an explicit 0 IS a figure');
      assert.ok(!/Priced after review/.test(out.innerHTML));
    });
    it('a BLANK SS316 cell is "Priced after review — … Material: Stainless Steel 316 Laboratory Grade", never the base alone', async () => {
      const { out, choose, env } = await setup(sheetWith(null));
      choose(316);
      await click(env, 'try', 'sink');
      assert.match(out.innerHTML, /Priced after review — no amount entered yet for: Material: Stainless Steel 316 Laboratory Grade\./);
      assert.ok(!/each/.test(out.innerHTML));
      assert.ok(!/chosen by our staff/.test(out.innerHTML), 'the screen is a STAFF session: SS316 is a valid choice here');
      void env;
    });
  });
});

describe('Inventory › Family Pricing — a conditional option says when it applies, and a family switched off for the website carries a chip (CONFIGURATOR-FAMILIES-2-SPEC §4.1, §6.4, §9)', () => {
  // a conditional option (fry baskets for a fryer, a pre-rinse sink on the soiled side of a dish table) is priced ONCE here — every value has its boxes — and its group header
  // says "Only when Type is Fryer" in the same muted style as the staff-only caption. A family listed in productMeta/config families.disabled gets a read-only chip.
  const open = async (fid, opts) => {
    const env = makeEnv(opts || {});
    await env.ctx.window.renderFamilyPricing(env.el, env.win.currentUser, 'president');
    await click(env, 'toggle', fid); await flush();
    const html = env.el.innerHTML;
    const a = html.indexOf(`data-fid="${fid}" style="margin-bottom:12px"`);
    const b = html.indexOf('<div class="card fp-card"', a + 10);
    return { env, card: html.slice(a, b < 0 ? html.length : b), inputs: inputsFromHtml(html, fid) };
  };
  const headers = (card) => [...card.matchAll(/<tr class="fp-grp"><td[^>]*><strong>([^<]*)<\/strong>([^]*?)<\/td><\/tr>/g)].map((m) => [unesc(m[1]), [...m[2].matchAll(/<span class="fp-when"[^>]*>· Only when ([^<]*)<\/span>/g)].map((x) => unesc(x[1]))]);

  it('the cooking line: "Burners" and "Fry baskets" headers carry their condition, "Type" and "Base" carry none — and the caption has the same muted style as the staff-only one', async () => {
    const { card } = await open('cooking_line');
    assert.deepEqual(headers(card), [['Material', []], ['Type', []], ['Burners', ['Type is Griddle or Lava-rock griller']], ['Fry baskets', ['Type is Fryer']], ['Base', []]]);
    assert.match(card, /<span class="fp-when" style="font-size:11px;color:var\(--text-muted\)">· Only when Type is Fryer<\/span>/);
    assert.equal(card.split('fp-staffonly').length - 1, 1, 'the only staff-only caption on the cooking line is the Material header\'s (it has no top plate)');
  });
  it('the dish table: only the pre-rinse sink is conditional; its staff-only top plate keeps its own caption beside the others', async () => {
    const { card } = await open('dish_table');
    assert.deepEqual(headers(card), [['Material', []], ['Side', []], ['Dishwasher on the', []], ['Pre-rinse sink', ['Side is Soiled']], ['Undershelf', []], ['Top plate', []], ['Length', []]], 'the dish table is a linear family: its length rate is the last group');
    assert.equal(card.split('fp-staffonly').length - 1, 2, 'Material and Top plate: the two staff-only groups');
  });
  it('every family that has no conditional option shows no "Only when" caption anywhere', async () => {
    for (const fid of ['prep_table', 'sink', 'stove', 'wok_range', 'deck_oven', 'hood', 'cabinet', 'wall_shelf', 'rack']) {
      const { card } = await open(fid);
      assert.ok(!card.includes('fp-when') && !/Only when/.test(card), fid);
    }
  });
  it('EVERY value of a conditional option still has its two amount boxes (a three-basket fryer is priced once), and the standard value is "adds nothing"', async () => {
    const { card, inputs } = await open('cooking_line');
    const boxes = (g) => inputs.filter((i) => i.attrs['data-g'] === g).map((i) => `${i.attrs['data-v']}|${i.attrs['data-k']}`);
    assert.deepEqual(boxes('baskets'), ['1|flat', '1|perW100', '3|flat', '3|perW100'], 'baskets 2 is the standard');
    assert.deepEqual(boxes('burners'), ['2|flat', '2|perW100', '3|flat', '3|perW100']);
    assert.deepEqual(boxes('type'), ['griller|flat', 'griller|perW100', 'fryer|flat', 'fryer|perW100', 'combi|flat', 'combi|perW100']);
    assert.deepEqual(boxes('base'), ['shelf|flat', 'shelf|perW100']);
    assert.deepEqual(boxes('grade'), ['316|flat', '316|perW100'], 'the staff-only steel grade: SS304 is the standard');
    assert.match(card, /Fry baskets[^]*?2 baskets|Fry baskets[^]*?Standard option — adds nothing/, 'the default basket count adds nothing');
    assert.match(card, /0 of 9 amounts entered/, 'the cooking line has 8 cells to fill (spec §5.2) and the SS316 cell');
  });
  it('the length-rate row is for the linear families only (dish table, deck oven, wall shelving)', async () => {
    for (const [fid, linear] of [['dish_table', true], ['deck_oven', true], ['wall_shelf', true], ['cooking_line', false], ['hood', false], ['wok_range', false], ['sink', false]]) {
      const { card } = await open(fid);
      assert.equal(/Per 100 mm from the standard length \(both directions\)/.test(card), linear, fid);
    }
  });
  it('the saved note of the deck oven\'s length rate ("Enter 0 …") is shown, escaped, beside its box — and the box is EMPTY until Finance enters 0', async () => {
    const note = 'Enter 0: the width is fixed by the trays per deck and its cost sits in the "Trays per deck: 6" cell.';
    const sheet = { familyId: 'deck_oven', schemaVersion: FAKE_SCHEMA, approved: false, options: {}, size: { perW100: null, confidence: 'blank', derivation: note } };
    const { card, inputs } = await open('deck_oven', { docs: { deck_oven: sheet } });
    assert.ok(card.includes(note.replace(/"/g, '&quot;')), 'the instruction is on the screen');
    assert.equal(inputs.find((i) => i.attrs['data-g'] === 'size').value, '', 'blank, not 0');
  });

  it('the kill switch (productMeta/config families.disabled): a listed family carries a "Disabled on the website" chip, the others do not; it is informational (no button, no extra read)', async () => {
    const env = makeEnv({ meta: { families: { disabled: ['hood', 'cooking_line'] } } });
    await env.ctx.window.renderFamilyPricing(env.el, env.win.currentUser, 'president');
    const html = env.el.innerHTML;
    const cardOf = (fid) => { const a = html.indexOf(`data-fid="${fid}" style="margin-bottom:12px"`); const b = html.indexOf('<div class="card fp-card"', a + 10); return html.slice(a, b < 0 ? html.length : b); };
    for (const fid of ['hood', 'cooking_line']) {
      assert.match(cardOf(fid), /<span class="badge badge-orange fp-off"[^>]*>Disabled on the website<\/span>/, fid);
      assert.equal(cardOf(fid).split('Disabled on the website').length - 1, 1, `${fid}: one chip`);
    }
    for (const fid of ['prep_table', 'sink', 'dish_table', 'stove', 'wok_range', 'deck_oven', 'cabinet', 'wall_shelf', 'rack']) assert.ok(!cardOf(fid).includes('Disabled on the website'), fid);
    assert.equal(html.split('Disabled on the website').length - 1, 2);
    assert.equal(env.reads.filter((r) => r === 'productMeta/config').length, 1, 'the same single read that fetches the material multiplier');
    assert.deepEqual(env.writes, [], 'reading the switch writes nothing');
    // a chip is not a control: no data-act on it, and the card still offers Open / Approve as before
    assert.ok(!/fp-off"[^>]*data-act/.test(html));
    assert.match(cardOf('hood'), /data-act="toggle"/);
  });
  it('no list, an empty list, junk in the list, a list that is not a list, or a family that does not exist: no chip anywhere (and nothing throws)', async () => {
    for (const meta of [undefined, { families: {} }, { families: { disabled: [] } }, { families: { disabled: 'hood' } }, { families: { disabled: { hood: true } } }, { families: 'hood' }, { families: { disabled: [5, null, {}, ['hood'], 'no_such_family'] } }, { quoteBuilder: { configurator: false } }]) {
      const env = makeEnv({ meta });
      await env.ctx.window.renderFamilyPricing(env.el, env.win.currentUser, 'president');
      assert.ok(!env.el.innerHTML.includes('Disabled on the website'), JSON.stringify(meta));
      assert.match(env.el.innerHTML, /fp-card/);
    }
  });
  it('reading the switch does not disturb the material multiplier read from the SAME document: "Try a configuration" still applies it', async () => {
    const PRIM = { title: 'Synthetic Sink', formulaType: 'per_length', basePrice: 15555, measurement: { W: 500, D: 500, H: 850 }, formula: { baseLengthMm: 500, pricePerExtraMm: 0, rateW100: 0, rateD100: 0, rateH100: 0 }, specs: [] };
    const env = makeEnv({ docs: { sink: OK_SHEET }, products: { 'PW-004': PRIM }, constants: { materialPriceIndexMultiplier: 2 }, meta: { families: { disabled: ['hood'] } } });
    await env.ctx.window.renderFamilyPricing(env.el, env.win.currentUser, 'president');
    await click(env, 'toggle', 'sink'); await flush();
    env.stubs.inputs.sink = inputsFromHtml(env.el.innerHTML, 'sink');
    const fam = env.ctx.window.QR_FAMILIES.families.sink;
    const ins = {};
    fam.groups.forEach((g) => { ins[g.key] = { value: String(Math.max(0, g.options.findIndex((o) => o.v === g.default))) }; });
    const out = { innerHTML: '' };
    const dims = [{ value: '500', getAttribute: () => 'W' }, { value: '500', getAttribute: () => 'D' }, { value: '850', getAttribute: () => 'H' }];
    env.stubs.tryBox.sink = { querySelector: (sel) => { const m = sel.match(/^\.fp-try-in\[data-g="(\w+)"\]$/); if (m) return ins[m[1]] || null; if (sel === '.fp-try-out') return out; return null; }, querySelectorAll: () => dims };
    await click(env, 'try', 'sink');
    assert.match(out.innerHTML, /31,110<\/strong> each/, '15,555 x the multiplier 2');
    assert.match(env.el.innerHTML, /Disabled on the website/, 'and the chip is there for the listed family');
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
    assert.match(env.toasts.at(-1).m, /none of the product families/);
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
    const byId = new Map(['PW-001', 'PW-003', 'PW-004', 'PW-029', 'CE-001', 'CE-006', 'CE-010', 'CE-012', 'EX-001', 'PW-015', 'PW-023', 'PW-010'].map((id, i) => [id, mk(id, { basePrice: 9000 + i * 1111 })]));
    const seed = DERIVE.deriveAll({ fams: FAMS, byId, constants: {}, masterName: 'fake.json' });
    const r = FP().planImport(JSON.parse(JSON.stringify(seed)), {});
    assert.ok(!r.error, r.error);
    assert.equal(r.plan.length, 11, 'one sheet per family, all eleven');
    assert.deepEqual([...r.plan.map((p) => p.fid)], [...FAMS.order]);              // (copied out of the vm realm so deepEqual compares prototypes of THIS realm)
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

  // QUOTE-BUILDER-CONFIGURATOR-SPEC §6.1 (2026-10-28): the builder has a configurator now. "Open in Quote Builder" maps every request line through
  // QBConfigured.fromRequestItem (js/qb-configured.js, pure — its own tests are tests/qb-configured.test.mjs) and hands the builder the request's
  // company / lead source / location / purpose / sourceRef. A priced line lands under priceBasis 'website' (the cost-plus auto-pricer leaves it
  // alone because of the BASIS — no priceManual flag any more); an unpriced one lands at zero, 'manual', needsPrice. The Quotes card and the
  // link-back to the request live in tests/quote-link.test.mjs.
  describe('Open in Quote Builder', () => {
    const REF = 'QR-261021-K7M2PX';
    const QB = (() => { const c = vm.createContext({ window: {}, console }); vm.runInContext(read('js/qb-configured.js'), c); return c.window.QBConfigured; })();
    const plain = (x) => JSON.parse(JSON.stringify(x));
    // the real screen + the real escHtml + the real QR_DEF (for the labels) + the real QBConfigured, with the few app globals the screen touches
    const builderSandbox = (role, { helpers = true } = {}) => {
      const toasts = [], navs = [];
      const win = { currentRole: role, currentDepts: ['Sales'], bizDate: () => '2026-10-21', renderEmptyState: (o) => `<div>${o.title}</div>` };
      const c = vm.createContext({ window: win, emojiIcon: (g) => `[${g}]`, console, Notifs: { showToast: (m, t) => toasts.push({ m, t }) }, navigateTo: (p) => navs.push(p) });
      vm.runInContext(escSrc, c);
      vm.runInContext(read('js/qr-def.js'), c);
      if (helpers) vm.runInContext(read('js/qb-configured.js'), c);
      vm.runInContext(read('js/screens/quote-requests.js'), c);
      const open = (doc) => { c.__doc = doc; vm.runInContext('_qrCurrent = __doc', c); };
      return { c, win, toasts, navs, open };
    };
    const fixedItem = (over) => Object.assign({ n: 2, kind: 'fixed', id: 'RF-003', name: 'Chiller', cat: 'Refrigeration', unit: 'pc', qty: 3, size: { W: 1200 }, specs: [{ label: 'Doors', value: 'Two' }], note: 'n' }, over || {});
    const fixedLine = (over) => Object.assign({ n: 2, id: 'RF-003', kind: 'fixed', priced: true, unitPrice: 5111, lineTotal: 15333, formulaType: 'per_length' }, over || {});
    const request = (over) => Object.assign({
      id: REF,
      contact: { name: 'Ana Reyes', company: 'Reyes Foods', mobile: '0917 555 0101', email: 'ana@example.test' },
      intake: { need: 'equipment', useFor: 'restaurant_cafe', entityType: 'private', targetDate: '2026-11-30', targetFlexible: false, address: 'Unit 4, Katipunan Ave, Quezon City, Metro Manila', notes: 'Call before visiting' },
      estimate: { shown: true, low: 87350, high: 104750, step: 50, vatBasis: 'exclusive', deliveryIncluded: false },
      items: [famItem(), fixedItem()],
      internal: { lines: [famLine(), fixedLine()], exactTotal: 88739 },
    }, over || {});

    it('a priced CONFIGURED line lands as a real configured line — family, options and size kept — at the figure the client\'s estimate was built from, under the website basis', () => {
      const out = plain(QB.fromRequestItem(famItem(), famLine(), REF));
      assert.equal(out.familyId, 'sink');
      assert.deepEqual(out.config, { basins: 2, alignment: 'center', undershelf: true, upper: false, faucet: 'gooseneck' });
      assert.deepEqual(out.size, { W: 1800, D: 700, H: 900 });
      assert.equal(out.id, 'PW-004', 'the family\'s primary SKU stays the line id');
      assert.equal(out.name, 'Sink', 'no "(configured)" suffix any more — it IS configured');
      assert.equal(out.specStr, 'Sinks: 2 sinks, Position: Centre, Undershelf: With undershelf, Faucet: Gooseneck');
      assert.deepEqual(out.specs.map((s) => s.label), ['Sinks', 'Position', 'Undershelf', 'Faucet']);
      assert.equal(out.dims, 'L1800 × W700 × H900 mm');
      assert.equal(out.qty, 2);
      assert.equal(out.unitPrice, 36703); assert.equal(out.amount, 73406);
      assert.equal(out.priceBasis, 'website'); assert.equal(out.basisUnitPrice, 36703);
      assert.ok(!('priceManual' in out), 'no priceManual: the BASIS holds the auto-pricer off, so the staff can still choose the cost-based price per line');
      assert.ok(!('needsPrice' in out));
      assert.equal(out.notes, 'Near the loading door');
      assert.equal(out.formulaType, 'fixed');
      assert.deepEqual(out.sourceRef, { kind: 'qr', ref: REF, n: 1 }, 'the line knows which request line it came from');
      assert.ok(!('_cfg' in out), '_cfg is runtime-only and is computed by the builder, never carried in');
    });

    it('an UNPRICED configured line lands at zero as priceBasis "manual" with needsPrice — for every reason, and with no line at all — never at the bare SKU\'s price', () => {
      const cases = [famLine({ priced: false, unitPrice: 0, lineTotal: 0, reason: 'missing_input' }), null, undefined];
      for (const reason of ['not_approved', 'size_basis', 'no_price', 'no_base_price']) cases.push(famLine({ priced: false, unitPrice: 0, lineTotal: 0, reason }));
      for (const line of cases) {
        const out = plain(QB.fromRequestItem(famItem(), line, REF));
        assert.equal(out.unitPrice, 0); assert.equal(out.amount, 0); assert.equal(out.basisUnitPrice, 0);
        assert.equal(out.priceBasis, 'manual', JSON.stringify(line)); assert.equal(out.needsPrice, true);
        assert.ok(!('priceManual' in out));
        assert.equal(out.id, 'PW-004'); assert.equal(out.familyId, 'sink'); assert.equal(out.name, 'Sink');
        assert.equal(QB.isAutoPriceable(out), false, 'the builder\'s auto-pricer must not fill in the bare SKU price');
      }
      // a line the server marked priced but with no usable figure is NOT priced either (fail closed: a string "yes" / a zero / a negative)
      for (const bad of [{ priced: true, unitPrice: 0 }, { priced: true, unitPrice: -5 }, { priced: 'yes', unitPrice: 9000 }, { priced: true, unitPrice: 'x' }]) {
        const out = QB.fromRequestItem(famItem(), famLine(bad), REF);
        assert.equal(out.priceBasis, 'manual', JSON.stringify(bad)); assert.equal(out.unitPrice, 0); assert.equal(out.needsPrice, true);
      }
    });

    it('a FIXED line: priced -> the website basis at the list figure (values only in the description, no suffix, no priceManual); unpriced -> manual + needsPrice', () => {
      const out = plain(QB.fromRequestItem(fixedItem(), fixedLine(), REF));
      assert.equal(out.name, 'Chiller');
      assert.equal(out.specStr, 'Two');
      assert.equal(out.unitPrice, 5111); assert.equal(out.amount, 15333);
      assert.equal(out.priceBasis, 'website'); assert.equal(out.basisUnitPrice, 5111);
      assert.ok(!('priceManual' in out)); assert.ok(!('familyId' in out)); assert.ok(!('config' in out));
      assert.equal(out.formulaType, 'per_length');
      assert.equal(out.dims, 'L1200 mm');
      assert.deepEqual(out.sourceRef, { kind: 'qr', ref: REF, n: 2 });
      const un = plain(QB.fromRequestItem(fixedItem(), fixedLine({ priced: false, unitPrice: 0, lineTotal: 0 }), REF));
      assert.equal(un.priceBasis, 'manual'); assert.equal(un.needsPrice, true); assert.equal(un.unitPrice, 0);
      assert.equal(QB.isAutoPriceable(un), false, 'an unpriced plain line used to land at 0 and be auto-priced silently — that is what the basis now forbids');
    });

    it('hostile or odd input cannot break the mapping: strings are coerced, qty is a positive integer, nothing throws', () => {
      const out = QB.fromRequestItem(famItem({ qty: '-4', specs: [null, { label: 5, value: undefined }], note: undefined, name: undefined }), famLine({ unitPrice: 'x' }), REF);
      assert.equal(out.qty, 1);
      assert.equal(typeof out.name, 'string');
      assert.equal(out.unitPrice, 0);
      assert.ok(Array.isArray(out.specs));
    });

    describe('the hand-off state (qrOpenInBuilder -> window._qbReopenState)', () => {
      const run = (doc, role) => { const S = builderSandbox(role || 'president'); S.open(doc || request()); S.win.qrOpenInBuilder(REF); return S; };

      it('carries the client fields, Barro Kitchens (BK), the Website lead source (WB), the location code, the purpose, the sourceRef and handoff:true', () => {
        const S = run();
        const st = plain(S.win._qbReopenState);
        assert.deepEqual([st.clientName, st.clientCompany, st.clientPhone, st.clientEmail, st.clientAddress], ['Ana Reyes', 'Reyes Foods', '0917 555 0101', 'ana@example.test', 'Unit 4, Katipunan Ave, Quezon City, Metro Manila']);
        assert.equal(st.currentCo, 'BK');
        assert.equal(st.qnoMethod, 'WB');
        assert.equal(st.qnoLoc, 'ML');
        assert.equal(st.purpose, 'Restaurant');
        assert.equal(st.subject, '');
        assert.equal(st.handoff, true);
        assert.equal(st.sourceRef.kind, 'qr'); assert.equal(st.sourceRef.ref, REF);
        assert.deepEqual(st.sourceRef.estimate, { low: 87350, high: 104750, step: 50, vatBasis: 'exclusive', deliveryIncluded: false });
        assert.deepEqual([st.sourceRef.targetDate, st.sourceRef.targetFlexible, st.sourceRef.entityType, st.sourceRef.name], ['2026-11-30', false, 'private', 'Ana Reyes']);
        assert.equal(st.sourceRef.useForLabel, 'Restaurant / café');
        assert.equal(st.sourceRef.notes, 'Call before visiting');
        assert.equal(S.win._qbReopenAsRevision, false);
        assert.deepEqual(S.navs, ['bk-quote-builder']);
        assert.ok(S.toasts.some((t) => t.t === 'success' && /Opening Quote Builder/.test(t.m)));
      });
      it('its lines are exactly fromRequestItem of each request line, each carrying the reference, and none of them is auto-priceable', () => {
        const S = run();
        const st = plain(S.win._qbReopenState);
        assert.equal(st.items.length, 2);
        assert.deepEqual(st.items, plain([QB.fromRequestItem(famItem(), famLine(), REF), QB.fromRequestItem(fixedItem(), fixedLine(), REF)]));
        assert.deepEqual(st.items.map((i) => i.sourceRef), [{ kind: 'qr', ref: REF, n: 1 }, { kind: 'qr', ref: REF, n: 2 }]);
        for (const i of st.items) assert.equal(QB.isAutoPriceable(i), false, i.id);
      });
      it('purpose follows the pinned table (a government entity is a bidding whatever the use); the location code follows the address', () => {
        const t = (intake) => plain(run(request({ intake: Object.assign({}, request().intake, intake) })).win._qbReopenState);
        assert.equal(t({ useFor: 'hospital' }).purpose, 'Hospital / Institutional');
        assert.equal(t({ useFor: 'hotel_resort' }).purpose, 'Hotel Restaurant');
        assert.equal(t({ useFor: 'home' }).purpose, 'Residential');
        assert.equal(t({ useFor: 'restaurant_cafe', entityType: 'government' }).purpose, 'Government / Bidding');
        assert.equal(t({ useFor: 'something-new' }).purpose, 'Other');
        assert.equal(t({ address: 'San Fernando, La Union' }).qnoLoc, 'LU');
        assert.equal(t({ address: 'Poblacion, Davao City' }).qnoLoc, 'DA');
        assert.equal(t({ address: 'Somewhere remote' }).qnoLoc, 'OT');
        assert.equal(t({ address: undefined }).qnoLoc, 'OT');
      });
      it('no estimate shown to the client -> sourceRef.estimate is null (never a made-up range)', () => {
        for (const estimate of [{ shown: false, reason: 'below_min' }, {}, { shown: true }, { shown: true, low: 0, high: 0 }, { shown: 'yes', low: 5, high: 9 }]) {
          assert.equal(plain(run(request({ estimate })).win._qbReopenState).sourceRef.estimate, null, JSON.stringify(estimate));
        }
      });
      it('a reference that is not a real one gets no link anywhere (no sourceRef on the state, none on the lines) — but the hand-off still opens', () => {
        const bad = request({ id: 'QR-1-X' });
        const S = builderSandbox('president'); S.open(bad); S.win.qrOpenInBuilder('QR-1-X');
        const st = plain(S.win._qbReopenState);
        assert.ok(!('sourceRef' in st)); assert.ok(st.items.every((i) => !('sourceRef' in i)));
        assert.equal(st.handoff, true); assert.deepEqual(S.navs, ['bk-quote-builder']);
      });
      it('only a staff writer opens it: the Corporate Secretary, a request that is not the open one, or a missing helper do NOT open the builder (the last says so)', () => {
        const sec = builderSandbox('secretary'); sec.open(request()); sec.win.qrOpenInBuilder(REF);
        assert.equal(sec.win._qbReopenState, undefined); assert.deepEqual(sec.navs, []);
        const other = builderSandbox('president'); other.open(request()); other.win.qrOpenInBuilder('QR-261021-ZZZZZZ');
        assert.equal(other.win._qbReopenState, undefined); assert.deepEqual(other.navs, []);
        const nohelp = builderSandbox('president', { helpers: false }); nohelp.open(request()); nohelp.win.qrOpenInBuilder(REF);
        assert.equal(nohelp.win._qbReopenState, undefined, 'without the helpers the lines cannot be mapped — and a bare-SKU fallback would hand the auto-pricer lines to reprice');
        assert.deepEqual(nohelp.navs, []);
        assert.ok(nohelp.toasts.some((t) => t.t === 'error' && /reload/.test(t.m)));
      });
    });
  });
});

// ══════════════════════════════════ firestore.rules ══════════════════════════════════
describe('firestore.rules › product_pricing — writes finance tier only, reads finance tier + the Sales tier (cirWriter), never public, the approver is named, the approved figures cannot change, nothing is deleted', () => {
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
  it('create / update are signed-in, with a users profile, senior-admin or finance; READ is the same plus the Sales tier (cirWriter) — and nothing is open to the public or to any signed-in user', () => {
    for (const op of ['create', 'update']) {
      const rule = allow(op);
      assert.match(rule, /isAuth\(\) && hasProfile\(\) && \(isSeniorAdmin\(\) \|\| canFinance\(\)\)/, op);
      assert.ok(!/cirWriter/.test(rule), `${op} must stay finance tier: the Sales tier may only READ the sheet`);
    }
    assert.match(allow('read'), /isAuth\(\) && hasProfile\(\) && \(isSeniorAdmin\(\) \|\| canFinance\(\) \|\| cirWriter\(\)\)/);
    for (const op of ['read', 'create', 'update']) {
      assert.ok(!/if true|if isAuth\(\);|if request\.auth != null;/.test(allow(op)), `${op} must not be open`);
    }
    assert.ok(!/allow (read|get|list|write):\s*if (true|isAuth\(\))\s*;/.test(block));
    assert.ok(!/allow write/.test(block), 'write is spelled out as create + update (no shortcut that would include delete)');
  });
  it('QUOTE-BUILDER-CONFIGURATOR-SPEC §2.4: the read gate names cirWriter() — president / manager or a NON-secretary Sales member — and nothing else was widened', () => {
    assert.match(allow('read'), /cirWriter\(\)/);
    assert.match(rules, /function cirWriter\(\) \{ return isSeniorAdmin\(\) \|\| \(!isSecretary\(\) && inDept\('Sales'\)\); \}/);
    assert.match(allow('read'), /hasProfile\(\)/, 'a signed-in identity with no users doc must never read the option amounts');
    assert.ok(!/cirWriter/.test(allow('delete')) && !/cirWriter/.test(allow('create')) && !/cirWriter/.test(allow('update')));
    assert.equal((block.match(/cirWriter/g) || []).length, 2, 'cirWriter may appear in the read rule and its explaining comment only');
  });
  it('a new sheet starts UNAPPROVED and can only be created under one of the ELEVEN family ids (CONFIGURATOR-FAMILIES-2-SPEC §8.1)', () => {
    const rule = allow('create');
    assert.match(rule, /familyId in \['prep_table', 'sink', 'dish_table', 'stove', 'wok_range', 'cooking_line', 'deck_oven', 'hood', 'cabinet', 'wall_shelf', 'rack'\]/, 'a sheet can only be created under one of the eleven family ids');
    assert.ok(!/matches\(/.test(rule), 'no free-form id pattern');
    assert.match(rule, /request\.resource\.data\.get\('approved', false\) == false/);
  });
  it('the create rule lists EXACTLY the families the site ships (QR_FAMILIES.order): a family cannot ship without its rules line — Family pricing "Set up" would be refused — and the rules never name an id nobody ships', async () => {
    const { createRequire } = await import('node:module');
    const FAMS = createRequire(import.meta.url)('../js/qr-families.js');
    const m = allow('create').match(/familyId in \[([^\]]*)\]/);
    assert.ok(m, 'no "familyId in [...]" list in the create rule');
    const ids = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
    assert.equal(new Set(ids).size, ids.length, 'an id is listed twice');
    assert.deepEqual([...ids].sort(), [...FAMS.order].sort());
    assert.equal(ids.length, 11);
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

// QUOTE-BUILDER-CONFIGURATOR-SPEC §3.5 (b)(c): a quote filed from a website request / project brief is linked back onto the request by the staff
// session (js/app.js bridge), so the two request collections gain exactly the link fields — nothing else — and the CIR status enum gains 'quoted'.
describe('firestore.rules › quote_requests / client_info_requests — the quote LINK fields, and nothing else, may be written by the Sales tier', () => {
  const rules = read('firestore.rules');
  const blockOf = (head) => { const s = rules.indexOf(head); assert.ok(s > 0, `no ${head}`); return rules.slice(s, rules.indexOf('\n    }\n', s) + 7); };
  const qrBlock = blockOf('match /quote_requests/{ref} {');
  const cirBlock = blockOf('match /client_info_requests/{ref} {');
  const upd = (b) => { const m = b.match(/allow update:[\s\S]*?;/); assert.ok(m, 'no allow update'); return m[0]; };
  const listOf = (re, b) => { const m = upd(b).match(re); assert.ok(m, `${re} not found`); return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')); };
  const LINK = ['quoteDocId', 'quotes', 'lastQuoteAt'];
  const BASE = ['status', 'statusChangedAt', 'statusChangedBy', 'statusChangedByName', 'convertedClientId', 'convertedAt', 'convertedBy'];

  it('the quote_requests update allowlist is EXACTLY the old keys + quoteDocId, quotes, lastQuoteAt (no request content can be rewritten)', () => {
    assert.deepEqual(listOf(/hasOnly\(\[([^\]]*)\]\)/, qrBlock), [...BASE, ...LINK, 'updatedAt']);
    const keys = listOf(/hasOnly\(\[([^\]]*)\]\)/, qrBlock);
    assert.ok(keys.includes('quotes') && keys.includes('lastQuoteAt'));
    for (const forbidden of ['items', 'contact', 'intake', 'estimate', 'internal', 'summary', 'consent', 'client', 'refNo']) assert.ok(!keys.includes(forbidden), forbidden);
  });
  it('the client_info_requests update allowlist is EXACTLY the old keys + quoteDocId, quotes, lastQuoteAt', () => {
    assert.deepEqual(listOf(/hasOnly\(\[([^\]]*)\]\)/, cirBlock), [...BASE, ...LINK, 'updatedAt']);
    for (const forbidden of ['answers', 'summary', 'photos', 'consent', 'client', 'refNo', 'formId']) assert.ok(!listOf(/hasOnly\(\[([^\]]*)\]\)/, cirBlock).includes(forbidden), forbidden);
  });
  it('the status enums: quote_requests unchanged; client_info_requests gains "quoted" between contacted and converted', () => {
    assert.deepEqual(listOf(/get\('status',''\) in \[([^\]]*)\]/, qrBlock), ['new', 'in_review', 'quoted', 'converted', 'archived']);
    assert.deepEqual(listOf(/get\('status',''\) in \[([^\]]*)\]/, cirBlock), ['new', 'in_review', 'contacted', 'quoted', 'converted', 'archived']);
  });
  it('quotes is a list of at most 50 entries whenever it is written — in BOTH collections, inside the update rule itself', () => {
    const guard = "(!request.resource.data.diff(resource.data).affectedKeys().hasAny(['quotes']) || (request.resource.data.get('quotes', []) is list && request.resource.data.get('quotes', []).size() <= 50))";
    for (const [name, b] of [['quote_requests', qrBlock], ['client_info_requests', cirBlock]]) {
      assert.ok(upd(b).includes('&& ' + guard), `${name}: the quotes list guard is missing or not a conjunct of the update rule`);
      assert.equal((b.match(/size\(\) <= 50/g) || []).length, 1, name);
    }
  });
  it('the rest of both rules is untouched: signed-in read with a users profile, no create / delete, Sales-tier writers only, attribution fields name the real writer', () => {
    for (const b of [qrBlock, cirBlock]) {
      assert.match(b, /allow read: if isAuth\(\) && hasProfile\(\);/);
      assert.match(b, /allow create, delete: if false;/);
      assert.match(upd(b), /allow update: if isAuth\(\) && cirWriter\(\)/);
      assert.match(upd(b), /statusChangedBy'\]\)\s*\|\|\s*request\.resource\.data\.statusChangedBy == request\.auth\.uid/);
      assert.match(upd(b), /convertedBy'\]\)\s*\|\|\s*request\.resource\.data\.convertedBy == request\.auth\.uid/);
    }
  });
});
