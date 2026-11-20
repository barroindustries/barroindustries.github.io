/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Forms engine core (pure)
   js/forms-core.js — Phase 1 of specs/SALES-FLOW-SPEC-2026-11-19.md §9, in the document format of the quote builder's printed Quotation
   (owner rulings 2026-11-19: "the right formats" = quote-builder-v2.html, as reviewed in the ops-flow prototype — markup and wording only,
   nothing imported from it — and the final header/numbering ruling below).
   ═══════════════════════════════════════════════════
   No DOM, no Firebase global, no clock: everything here is Node-testable (tests/forms-*.test.mjs) behind the same one-line `window` shim
   js/money-core.js uses. Loaded lazily by js/forms.js; never from index.html (CLAUDE.md "app-kit" rule). It holds:

     HEADER (final owner ruling)  LEFT: the horizontal Barro Industries logo, and under it the company line exactly (HEADER_LINE). RIGHT: the form
                             title, then the number, the date and the references. A Barro Kitchens document ONLY carries the small BK tile above the
                             title; Barro Industries documents carry none. Brilliant Steel orders use the Barro Industries header (formCompany) —
                             only the Brilliant Steel QUOTATION keeps its own header, and that is the quote builder's, not this engine's. The header
                             is built here (headerHtml, classes fh-*) from the owner-reviewed prototype's values; js/letterhead.js is not used.
     COMPANIES / companyOf   the quote builder's per-company table (its `const CO`, mirrored — tests/forms-core.test.mjs pins every field against
                             quote-builder-v2.html and js/config.js BRAND.companies): the thanks line, creds line and signer of the footer and the
                             signature dividers. The company FOLLOWS THE ORDER / QUOTE; unknown → BI.
     numbers                 ONE serial for the pair: SO-0012 and JO-0012 are the same number with two prefixes (counter form_SO). A revision is the
                             quote's R convention with a space — "SO-0012 R1", "JO-0012 R1" — never "Rev. 1", in the header and in the file name. PA
                             keeps its own series (PA-0031). The quotation reference stays in the quote-number style (BKMLFB260930-007R1). assignWith()
                             stores a missing serial in ONE transaction with its counter, so a refused write burns no number, and only where TODAY'S
                             firestore.rules let the viewer write that field.
     the peso wall (§9.7)    register() refuses an 'ops' entry with a money field; build() copies ONLY declared fields; assertNoPesos() scans the built
                             data — keys and every string, free text included. A form with a price in its notes is refused, not printed.
     the title guard (§9.8)  assertTitleAllowed(): no "Official Receipt", no "Sales Invoice" in any form TITLE or heading. (Body text is out of scope:
                             the Payment Acknowledgement says "This is not an official receipt…", which is what it must say.)
     the registry            register()/get()/list() and the four Phase 1 entries (sales_order, job_order, payment_ack, handoff_pack).
     prepare() / compose()   audience → guard → number → data → header/meta, then the quote-style page (letterhead header, bill strip, subject,
                             sections, grey terms cards, signature dividers, thanks/creds footer). Bodies (js/forms-set-1.js) return the sections.

   FORMAT (what is matched from quote-builder-v2.html, and where it comes from)
     header            the owner's final layout (see HEADER above), navy #1F3A5F, a 2.5px navy rule, en-PH long date.
     sections          .section / .sec-title (uppercase navy, 1.5px navy rule), navy <th>, .cat-row light-blue bands, .subtotal-row, .totals-tbl
                       with Subtotal and the GRAND TOTAL row, .pay-tbl banded light-blue info rows, .bill-strip + Subject line, .terms-grid grey cards.
     signatures        .sig-row / .sig-box / .sig-role (PREPARED BY · REVIEWED & APPROVED BY · CONFORME — ACCEPTED BY CLIENT), centred upper-case names.
     footer            .print-footer: navy rule, bold thanks line, grey creds line (CO.thanks / CO.creds).
     print             letterhead's own print rules, i.e. @page A4 with 11mm 10mm 7mm margins, rows kept whole, header rows repeated.
     workforce copy    'WORKFORCE COPY — NO PRICES' in the header's extraMeta (JO and Handoff pack): item columns # / DESCRIPTION / QTY / UNIT only,
                       the ±5mm tolerance note, no totals, no peso anywhere.                                                                         */
if (typeof window === 'undefined') { globalThis.window = globalThis; }

(function () {
  'use strict';

  const W = () => (typeof window !== 'undefined' ? window : globalThis);
  const FC = { VERSION: 3 };

  // ── small total helpers ──────────────────────────────────────────────────────────────────────────────────
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const str = (v) => (v == null ? '' : String(v).trim());
  const arr = (v) => (Array.isArray(v) ? v : []);
  const fin = (v) => { const n = Number(v); return (v === null || v === undefined || v === '' || !isFinite(n)) ? null : n; };
  const first = (...vs) => { for (const v of vs) { const s = str(v); if (s) return s; } return ''; };
  const nl2br = (s) => esc(s).replace(/\r?\n/g, '<br>');
  function makeError(code, message, extra) { const e = new Error(message); e.code = code; return Object.assign(e, extra || {}); }
  function getPath(obj, path) {
    let cur = obj;
    for (const k of String(path).split('.')) { if (cur == null) return undefined; cur = cur[k]; }
    return cur;
  }
  function clonePlain(v, depth) {
    depth = depth || 0;
    if (v === null || typeof v !== 'object') return v;
    if (depth > 10) return null;
    if (Array.isArray(v)) return v.map((x) => clonePlain(x, depth + 1));
    if (v instanceof Date) return v.toISOString();
    if (typeof v.toDate === 'function') { try { return v.toDate().toISOString(); } catch (_) { return null; } }
    const o = {};
    Object.keys(v).forEach((k) => { o[k] = clonePlain(v[k], depth + 1); });
    return o;
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════
  //  COMPANIES — the quote builder's `const CO` (quote-builder-v2.html ≈2221), field for field. The builder is an <iframe> and cannot share
  //  this file, so it is a hand-synced mirror like config.js's BRAND.companies; tests/forms-core.test.mjs fails if either drifts.
  //  `logo` is the builder's per-company mark ('' for Brilliant Steel); a FORM's header does not use it (see HEADER below).
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════
  const ADDR = '21 Capricorn St., Tandang Sora, Quezon City, 1116 Metro Manila';
  const CONTACT = '09276836300  |  hello@barroindustries.com';
  const CREDS = 'Barro Industries OPC  •  SEC Registered  •  hello@barroindustries.com  •  09276836300  •  ' + ADDR;
  const SIG_NEIL = Object.freeze({ name: 'NEIL BARRO', title: 'President, Barro Industries OPC' });
  FC.COMPANIES = Object.freeze({
    BK: Object.freeze({ code: 'BK', name: 'BARRO KITCHENS', sub: 'By Barro Industries OPC', addr: ADDR, contact: CONTACT, sig: SIG_NEIL,
      thanks: 'Thank you for considering Barro Kitchens. We look forward to building a kitchen you can rely on for years.',
      creds: CREDS, logo: 'icons/barro-kitchens.png' }),
    BI: Object.freeze({ code: 'BI', name: 'BARRO INDUSTRIES OPC', sub: 'SEC-registered One Person Corporation', addr: ADDR, contact: CONTACT, sig: SIG_NEIL,
      thanks: 'Thank you for considering Barro Industries. We look forward to fabricating work you can rely on for years.',
      creds: CREDS, logo: 'icons/barro-industries.png' }),
    BS: Object.freeze({ code: 'BS', name: 'BRILLIANCE STEEL CORPORATION', sub: '', addr: 'Pasig City, Metro Manila', contact: '09276836300',
      sig: Object.freeze({ name: 'GERALD CHAN', title: 'President, Brilliance Steel Corporation' }),
      thanks: 'Thank you for considering Brilliance Steel Corporation. We are committed to quality steelworks delivered on time.',
      creds: 'Brilliance Steel Corporation  •  SEC / BIR Registered  •  Pasig City, Metro Manila  •  0927 683 6300', logo: '' }),
  });
  FC.DEFAULT_COMPANY = 'BI';
  // The owner's navy for every form (rule, section titles, table headers, footer rule). The quote builder's own is #1E3A5F; the owner asked for this one.
  FC.NAVY = '#1F3A5F';
  FC.accentFor = () => FC.NAVY;
  // The company FOLLOWS the quote / order: the first record that names a KNOWN code wins; anything else (missing, retired 'PT', garbage) is BI.
  FC.companyOf = function (...records) {
    for (const r of records) {
      const c = str(r && r.company).toUpperCase();
      if (c && Object.prototype.hasOwnProperty.call(FC.COMPANIES, c)) return c;
    }
    return FC.DEFAULT_COMPANY;
  };
  // A FORM's company: BK or BI. Brilliant Steel orders use the Barro Industries identity (header, thanks line, creds line, signer).
  FC.formCompany = (code) => (code === 'BK' ? 'BK' : 'BI');
  // "BARRO KITCHENS" → "Barro Kitchens", "BARRO INDUSTRIES OPC" → "Barro Industries OPC" (the quote builder's titleCaseCo): the company inside a sentence
  FC.shortName = (code) => String((FC.COMPANIES[code] || FC.COMPANIES[FC.DEFAULT_COMPANY]).name).toLowerCase().split(/\s+/).filter(Boolean)
    .map((w) => (w === 'opc' ? 'OPC' : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════
  //  HEADER — owner rulings 2026-11-19 ("both") and 2026-11-20 (brand): "Barro Kitchens is the public name, it's the brand; Barro Industries OPC is
  //  the company". The right column is the same on every form: title, number, date, reference lines.
  //  · Barro Kitchens documents (BK): LEFT is the Barro Kitchens mark + BARRO KITCHENS, "By Barro Industries OPC" under it as the legal company line,
  //    then address · phone · both emails (the quote builder's CO.BK letterhead). The horizontal Barro Industries logo is NOT used.
  //  · Barro Industries documents (BI, and Brilliant Steel orders, whose form company is BI): the horizontal Barro Industries logo + HEADER_LINE.
  //  Signatures, the creds footer and other legal lines keep Barro Industries OPC on both.
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════
  FC.HEADER_LOGO = 'icons/barro-industries-horizontal.png';
  FC.HEADER_PARTS = Object.freeze(['Barro Industries OPC', '21 Capricorn St., Tandang Sora, Quezon City', 'hello@barroindustries.com', 'barroindustries@gmail.com', '0927 683 6300']);
  FC.HEADER_LINE = FC.HEADER_PARTS.join(' · ');
  FC.BRAND = Object.freeze({
    BK: Object.freeze({ mark: 'icons/barro-kitchens.png', name: 'BARRO KITCHENS', legal: 'By Barro Industries OPC',
      parts: Object.freeze(['21 Capricorn St., Tandang Sora, Quezon City', '0927 683 6300', 'hello@barroindustries.com', 'barroindustries@gmail.com']) }),
  });
  // a site-relative asset URL that also resolves inside html2canvas's clone and the off-screen export host
  const asset = (path) => { try { return W().location.origin + W().location.pathname.replace(/[^/]*$/, '') + path; } catch (_) { return path; } };
  // each part is a no-wrap span with its dot attached, so the line only ever wraps between parts
  const coLine = (parts) => parts.map((p, i) => `<span>${esc(p)}${i < parts.length - 1 ? ' ·' : ''}</span>`).join(' ');
  FC.headerHtml = function (prep) {
    const brand = FC.BRAND[prep.co.code];
    const left = brand
      ? `<div class="fh-brand"><img class="fh-mark" src="${esc(asset(brand.mark))}" alt="Barro Kitchens" width="48" height="48" onerror="this.style.display='none'">` +
        `<div><div class="fh-name">${esc(brand.name)}</div><div class="fh-legal">${esc(brand.legal)}</div></div></div>` +
        `<div class="fh-co">${coLine(brand.parts)}</div>`
      // the logo's PNG has transparent margins; the negative margins cancel them, as in the prototype
      : `<img class="fh-logo" src="${esc(asset(FC.HEADER_LOGO))}" alt="Barro Industries OPC" width="168" height="56" onerror="this.style.display='none'">` +
        `<div class="fh-co">${coLine(FC.HEADER_PARTS)}</div>`;
    return `<div class="fh-header"><div class="fh-id">${left}</div>` +
      `<div class="fh-doc"><div class="fh-title">${esc(prep.title)}</div><div class="fh-no">${esc(prep.numberText)}</div><div class="fh-date">${esc(prep.dateLabel)}</div>` +
      arr(prep.extraMeta).map((m) => `<div class="fh-meta">${esc(m)}</div>`).join('') + `</div></div>`;
  };

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════
  //  numbers, names, dates, pesos
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════
  FC.fmtNumber = (series, n) => String(series) + '-' + String(Math.max(0, Math.floor(Number(n) || 0))).padStart(4, '0');
  // The quote's revision convention, with a space: "SO-0012 R1", "JO-0012 R2". Revision 0 / none leaves the number as it is.
  FC.withRev = function (number, rev) {
    const r = Math.floor(Number(rev));
    return (number && r > 0) ? String(number) + ' R' + r : String(number == null ? '' : number);
  };
  const FILE_PREFIX = { quotation: 'Quotation-' };
  const cleanName = (s) => String(s == null ? '' : s).replace(/[^A-Za-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
  // Letters, digits and hyphens only ("SO-0012 R1" → SO-0012-R1.pdf); used exactly as given by print-docs' `fileName` option.
  FC.fileName = function (formId, number, rev) {
    return (cleanName((FILE_PREFIX[formId] || '') + FC.withRev(number, rev)) || 'document') + '.pdf';
  };
  // The job number is the quotation number without its revision suffix, dash optional (…001-R3 and the v14 compact …001R3 both exist).
  FC.jobRef = (quoteNumber) => str(quoteNumber).replace(/-?R\d+\s*$/i, '');
  FC.last6 = (id) => String(id == null ? '' : id).slice(-6).toUpperCase();
  // SO and JO are ONE serial with two prefixes. serialOf('JO-0012') → '0012'.
  const serialOf = (n) => { const m = /^(?:SO|JO)-(\d{4,})$/.exec(str(n)); return m ? m[1] : ''; };
  FC.serialOf = serialOf;
  // The counter a series draws from: the job order has none of its own (JO numbers come from the sales-order counter, form_SO).
  FC.counterName = (series) => 'form_' + (String(series) === 'JO' ? 'SO' : String(series));

  const manilaIso = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  // ISO date (Manila) from an ISO string, a Firestore Timestamp (toDate / {seconds}), or a Date. '' when it is none of those.
  FC.toIsoDate = function (v) {
    if (v == null || v === '') return '';
    let d = null;
    if (typeof v === 'string') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return v.trim();
      d = new Date(v);
    } else if (v instanceof Date) d = v;
    else if (typeof v.toDate === 'function') { try { d = v.toDate(); } catch (_) { d = null; } }
    else if (typeof v.seconds === 'number') d = new Date(v.seconds * 1000);
    return (d && !isNaN(d.getTime())) ? manilaIso(d) : '';
  };
  // The quote's own date format (applyLetterheadHeader: toLocaleDateString('en-PH', long)) → "November 19, 2026".
  FC.longDate = function (iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return '';
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00+08:00`);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Manila' });
  };
  // The quote's formatPeso(): '₱' + whole pesos, en-PH grouping — and centavos ONLY when the amount really has them (a payment must never be rounded on paper).
  FC.peso = function (n) {
    const v = Math.round((Number(n) || 0) * 100) / 100;
    const cents = Math.abs(v - Math.trunc(v)) > 0.0049;
    return (v < 0 ? '−' : '') + '₱' + Math.abs(v).toLocaleString('en-PH', cents ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 0 });
  };
  FC.plainNumber = (n) => (Number(n) || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 });

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════
  //  GUARDS — the title rule (§9.8) and the peso wall (§9.7)
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════
  // The Payment Acknowledgement's notice. It says "official receipt" on purpose: it is body text, and the title guard below covers titles only.
  FC.NOT_RECEIPT_NOTE = 'This is not an official receipt. The BIR official receipt is issued separately by Finance.';
  FC.PESO_IN_TEXT_MESSAGE = 'This form has a price in its notes. Remove it, then try again.';
  FC.PESO_KEY = /price|amount|total|cost|peso|contract|paid|collect|balance|budget|margin|markup|vat|discount|fee|credit|refund/i;
  const PESO_TEXT = /₱|PHP|Php/;

  // Until Shaira confirms the BIR registration and invoicing set-up the app generates no document TITLED with these. Runs at registration and every build.
  FC.assertTitleAllowed = function (title) {
    const t = String(title == null ? '' : title).toLowerCase().replace(/\s+/g, ' ');
    if (t.indexOf('official receipt') >= 0 || t.indexOf('sales invoice') >= 0) {
      throw makeError('banned-title', `"${title}" is not an allowed document title: use Payment Acknowledgement or Billing Statement.`);
    }
    return true;
  };

  // The approver's box on a Sales order and a Job order — the quote builder's own divider label (the ops-flow prototype's screenshots read "Approved by").
  FC.LABELS = Object.freeze({ approvedBy: 'Reviewed & Approved by' });

  // Walks the BUILT data: a key that names money, or any string holding ₱ / PHP / Php, throws. Free text (notes, instructions) is just a string
  // here, so a price typed into it is caught by the same scan and refused with a plain message instead of being printed.
  FC.assertNoPesos = function (data) {
    (function walk(v, path, depth) {
      if (v === null || v === undefined || depth > 12) return;
      if (typeof v === 'string') {
        if (PESO_TEXT.test(v)) throw makeError('peso-in-text', FC.PESO_IN_TEXT_MESSAGE, { path });
        return;
      }
      if (typeof v !== 'object') return;
      if (Array.isArray(v)) { v.forEach((x, i) => walk(x, path + '[' + i + ']', depth + 1)); return; }
      Object.keys(v).forEach((k) => {
        if (FC.PESO_KEY.test(k)) throw makeError('peso-key', 'This form cannot be built: it would carry a price field ("' + k + '").', { path: path ? path + '.' + k : k });
        walk(v[k], path ? path + '.' + k : k, depth + 1);
      });
    })(data, '', 0);
    return true;
  };

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════
  //  WHO MAY OPEN / WRITE (client mirror of firestore.rules — the rules are the real boundary, this only stops offering what they would refuse)
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════
  FC.viewer = function (v) {
    v = v || {};
    const depts = Array.isArray(v.depts) ? v.depts : Array.isArray(v.departments) ? v.departments : (v.department ? [v.department] : []);
    return { uid: str(v.uid), role: str(v.role).toLowerCase(), depts: depts.map(String), name: str(v.name || v.displayName) };
  };
  const isStaff = (v) => !!v.role;
  const isPresidentRole = (v) => v.role === 'president' || v.role === 'owner';
  // canFinance(): president / manager / finance role, or a Finance-department member who is not the Corporate Secretary.
  const isBooksTier = (v) => isPresidentRole(v) || v.role === 'manager' || v.role === 'finance' || (v.depts.indexOf('Finance') >= 0 && v.role !== 'secretary');
  const inDept = (v, d) => v.depts.indexOf(d) >= 0 && !(v.role === 'secretary' && (d === 'Finance' || d === 'IT'));
  FC.isBooksTier = (v) => isBooksTier(FC.viewer(v));
  // ops: every staff profile (Production with or without Design) · sales: Sales members, the books tier, the President · finance: the books tier.
  // `alsoDepts` widens sales/finance.
  FC.canOpenAudience = function (audience, viewer, alsoDepts) {
    const v = FC.viewer(viewer);
    if (!isStaff(v)) return false;
    if (audience === 'ops') return true;
    const extra = arr(alsoDepts).some((d) => inDept(v, d));
    if (audience === 'sales') return isBooksTier(v) || inDept(v, 'Sales') || extra;
    if (audience === 'finance') return isBooksTier(v) || extra;
    return false;
  };
  // QF's C4 is deployed (2026-11-20): firestore.rules lets Sales write `soNumber` on a confirmed (status recorded) order, so Sales stores the real serial.
  FC.RULES = { salesMayWriteSoNumber: true };
  // May THIS viewer write this serial field under today's rules? job_projects: any staff, as long as the key is not a money key (joNumber is not).
  // sales_orders / payment_claims: the books tier only (the confirmer).
  FC.canStoreNumber = function (coll, field, viewer) {
    const v = FC.viewer(viewer);
    if (!isStaff(v)) return false;
    if (coll === 'job_projects' && field === 'joNumber') return true;
    if (coll === 'sales_orders' && field === 'soNumber') return isBooksTier(v) || (FC.RULES.salesMayWriteSoNumber && inDept(v, 'Sales') && v.role !== 'secretary');
    if ((coll === 'sales_orders' || coll === 'payment_claims') && field === 'paNumber') return isBooksTier(v);
    return false;
  };

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════
  //  REGISTRY
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════
  const REG = Object.create(null);
  FC.AUDIENCES = ['ops', 'sales', 'finance'];
  FC.register = function (entry) {
    if (!entry || !entry.id || !entry.title) throw makeError('bad-entry', 'A form needs an id and a title.');
    if (REG[entry.id]) throw makeError('duplicate', `Form "${entry.id}" is already registered.`);
    if (FC.AUDIENCES.indexOf(entry.audience) < 0) throw makeError('bad-entry', `Form "${entry.id}": audience must be ops, sales or finance.`);
    FC.assertTitleAllowed(entry.title);
    if (entry.audience === 'ops') {
      const money = arr(entry.fields).filter((f) => f && f.money);
      if (money.length) throw makeError('ops-money-field', `Operations form "${entry.id}" cannot register a money field ("${money[0].key}").`);
    }
    REG[entry.id] = entry;
    return entry;
  };
  FC.get = (id) => REG[id] || null;
  FC.list = () => Object.keys(REG).map((k) => REG[k]);
  FC._unregister = (id) => { delete REG[id]; };            // tests only
  FC.canOpen = (entryOrId, viewer) => { const e = typeof entryOrId === 'string' ? REG[entryOrId] : entryOrId; return !!e && FC.canOpenAudience(e.audience, viewer, e.alsoDepts); };
  FC.titleCase = (t) => String(t || '').toLowerCase().replace(/(^|[\s(])([a-z])/g, (m, a, b) => a + b.toUpperCase());

  // The ONLY data that reaches a form: each declared field, read by its `from` (a 'a.b.c' path into ctx, or a function of ctx), into a NEW object.
  FC.build = function (entry, ctx) {
    FC.assertTitleAllowed(entry.title);
    const data = {};
    arr(entry.fields).forEach((f) => {
      const v = typeof f.from === 'function' ? f.from(ctx) : getPath(ctx, f.from);
      data[f.key] = v === undefined ? null : clonePlain(v);
    });
    if (entry.audience === 'ops') FC.assertNoPesos(data);
    return data;
  };

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════
  //  NUMBERS (§9.5) — stored serial, else the pair's, else the entry's fallback; revision from the record
  //    source 'stored'   the record carries it          'pair'      the other half of the SO/JO pair carries the serial (stored on request)
  //    source 'derived'  computed, never stored (HP-…)  'fallback'  nothing carries one: SO/PA = last 6 of the id, JO = the old derived number
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════
  FC.resolveNumber = function (entry, ctx) {
    const spec = entry.number || {};
    const rec = typeof spec.record === 'function' ? spec.record(ctx) : null;
    if (!rec) return { number: '', source: 'fallback', currentRev: 0 };           // no record, no number — never a bare "SO-"
    const currentRev = spec.revField ? Math.max(0, Math.floor(Number(rec[spec.revField]) || 0)) : 0;
    let number = '', source = 'fallback';
    if (typeof spec.resolve === 'function') { const r = spec.resolve(ctx) || {}; number = str(r.number); source = r.source || 'fallback'; }
    else if (typeof spec.derive === 'function') { number = str(spec.derive(ctx)); source = 'derived'; }
    else if (spec.field && str(rec[spec.field])) { number = str(rec[spec.field]); source = 'stored'; }
    else if (typeof spec.fallback === 'function') { number = str(spec.fallback(rec, ctx)); }
    return { number, source, currentRev };
  };

  const fail = (code, error, extra) => Object.assign({ ok: false, code, error }, extra || {});

  // Everything a form needs except its body: refusal checks, number, data, header texts, signatures.
  FC.prepare = function (formId, ctx, opts) {
    ctx = ctx || {}; opts = opts || {};
    const entry = REG[formId];
    if (!entry) return fail('unknown-form', 'That document is not available.');
    ctx.viewer = FC.viewer(ctx.viewer);
    if (!FC.canOpen(entry, ctx.viewer)) return fail('not-allowed', 'You do not have access to this document.');
    if (typeof entry.guard === 'function') { const msg = entry.guard(ctx); if (msg) return fail('refused', msg); }

    const company = FC.formCompany(ctx.company ? FC.companyOf({ company: ctx.company }) : FC.companyOf(ctx.order, ctx.project, ctx.claim, ctx.quote));
    const co = FC.COMPANIES[company];
    const num = FC.resolveNumber(entry, ctx);
    let rev = num.currentRev;
    if (opts.rev != null && Number(opts.rev) !== num.currentRev) {
      const asked = Math.max(0, Math.floor(Number(opts.rev) || 0));
      const found = typeof entry.revisionOf === 'function' ? entry.revisionOf(ctx, asked, num.currentRev) : null;
      if (!found) return fail('no-such-revision', 'That revision is not on record. Open the current one.');
      ctx.revEntry = found; rev = asked;
    }
    ctx.rev = rev;
    let data;
    try { data = FC.build(entry, ctx); }
    catch (e) {
      if (e && (e.code === 'peso-in-text' || e.code === 'peso-key')) return fail(e.code, e.message, { path: e.path });
      return fail('build-failed', 'This document could not be built.', { detail: e && e.message });
    }
    const docIso = FC.toIsoDate(typeof entry.date === 'function' ? entry.date(ctx) : '') || ctx.today || '';
    const revIso = rev > 0 && typeof entry.revisionDate === 'function' ? FC.toIsoDate(entry.revisionDate(ctx, rev)) : '';
    const dateIso = revIso || docIso;
    const extraMeta = (typeof entry.extraMeta === 'function' ? entry.extraMeta(ctx, data) : []).filter(Boolean);   // the revision date alone, as in the prototype
    return {
      ok: true, id: formId, entry, company, co, ctx, data,
      title: entry.title, number: num.number, numberSource: num.source, rev, currentRev: num.currentRev,
      numberText: FC.withRev(num.number, rev), dateIso, dateLabel: FC.longDate(dateIso), extraMeta,
      signatures: typeof entry.sign === 'function' ? entry.sign(ctx, data, co) : [],
      watermark: rev < num.currentRev ? 'SUPERSEDED' : '',
      fileName: FC.fileName(formId, num.number, rev), accent: FC.accentFor(company), orientation: entry.orientation === 'landscape' ? 'landscape' : 'portrait',
    };
  };

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════
  //  HTML helpers handed to the body renderers — the quote's own class names and markup (see FORMAT above). Text arguments are ESCAPED here;
  //  a value that is already markup must be wrapped with h.raw(). On an 'ops' form h.peso() throws.
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════
  FC.makeHelpers = function (entry, prep) {
    const ops = !!entry && entry.audience === 'ops';
    const co = (prep && prep.co) || FC.COMPANIES[FC.DEFAULT_COMPANY];
    const isRaw = (v) => v && typeof v === 'object' && typeof v.html === 'string';
    const text = (v) => (isRaw(v) ? v.html : esc(v));
    const h = {
      e: esc, nl2br, date: FC.longDate, int: FC.plainNumber, company: co.code, co, short: FC.shortName(co.code),
      raw: (html) => ({ html: String(html == null ? '' : html) }),
      peso: ops ? function () { throw makeError('peso-on-ops', 'An Operations form cannot print a peso amount.'); } : FC.peso,
    };
    // <div class="section"> + .sec-title — a heading never sits alone at the foot of a page (data-pdf-keep-next, and the quote's own print rule).
    // `flow` lets a tall section (the items table) split across pages, like the quote's #itemsSection; every other section is kept whole.
    h.section = (title, inner, o) => `<div class="section${o && o.flow ? ' flow' : ''}" data-pdf-cut><div class="sec-title" data-pdf-keep-next>${esc(title)}</div>${inner}</div>`;
    // "BILL TO: name — company" / address  |  ☎ phone  |  ✉ email / the grey third line (the quote's "Project Type:" line — here the quote's subject,
    // folded into the strip so the page stays compact) — exactly renderBillStrip()
    h.billStrip = (o) => {
      const parts = arr(o.parts).map(str).filter(Boolean);
      return `<div class="bill-strip" data-pdf-cut><div><strong>${esc(o.label || 'BILL TO')}:</strong> ${esc(o.name) || '—'}${str(o.company) ? ' — ' + esc(o.company) : ''}</div>` +
        (parts.length ? `<div>${parts.map(esc).join('  |  ')}</div>` : '') + (str(o.project) ? `<div class="f-proj">Project: ${esc(o.project)}</div>` : '') + '</div>';
    };
    // .pay-tbl: label | value rows, banded light-blue on every other row (the quote's pay-head). {head:true|false} on a row overrides the banding.
    h.infoTable = (rows) => {
      const list = arr(rows).filter(Boolean);
      const explicit = list.some((r) => r.head !== undefined);
      return `<table class="pay-tbl"><tbody>` + list.map((r, i) =>
        `<tr${(explicit ? r.head : i % 2 === 0) ? ' class="pay-head"' : ''}>${arr(r.cells || [r.label, r.value]).map((c) => `<td>${text(c)}</td>`).join('')}</tr>`).join('') + `</tbody></table>`;
    };
    h.note = (t) => `<div class="pay-note">${esc(t)}</div>`;
    h.text = (t) => `<div class="f-text">${nl2br(t)}</div>`;
    // Items table. cols: [{label, w, a:'c'|'r'|'l'}]; rows: [{cells:[…], cls?} | {cat:'LABEL'} | {sub:'Subtotal — X: ₱…'}]
    h.table = (o) => {
      const cols = arr(o.cols);
      const head = `<thead><tr>${cols.map((c) => `<th class="${c.a === 'c' ? 'ac' : c.a === 'r' ? 'ar' : ''}${c.cls ? ' ' + c.cls : ''}">${text(c.label)}</th>`).join('')}</tr></thead>`;
      const body = arr(o.rows).map((r) => {
        if (r.cat !== undefined) return `<tr class="cat-row"><td colspan="${cols.length}">${esc(r.cat)}</td></tr>`;
        if (r.sub !== undefined) return `<tr class="subtotal-row"><td colspan="${cols.length}">${text(r.sub)}</td></tr>`;
        return `<tr${r.cls ? ' class="' + esc(r.cls) + '"' : ''}>${arr(r.cells).map((c, i) => `<td class="${cols[i] && cols[i].a === 'c' ? 'ac' : cols[i] && cols[i].a === 'r' ? 'ar' : ''}">${text(c)}</td>`).join('')}</tr>`;
      }).join('');
      return `<table class="${esc(o.cls || 'items-table')}"><colgroup>${cols.map((c) => `<col style="width:${esc(c.w)}">`).join('')}</colgroup>${head}<tbody>${body}</tbody></table>`;
    };
    // The 2-column totals box: [{label, amt, cls:'grand'|'discount'}]
    h.totals = (rows, note) => `<div class="totals-box" data-pdf-cut><table class="totals-tbl">` + arr(rows).map((r) =>
      `<tr${r.cls ? ' class="' + esc(r.cls) + '"' : ''}><td>${esc(r.label)}</td><td>${esc(r.amt)}</td></tr>`).join('') +
      (note ? `<tr class="cur-note"><td colspan="2">${esc(note)}</td></tr>` : '') + `</table></div>`;
    // .terms-grid: two-column grey cards. card: {title, text, full?}
    h.cards = (cards) => `<div class="terms-grid">` + arr(cards).filter(Boolean).map((c) =>
      `<div class="terms-block${c.full ? ' full' : ''}" data-pdf-cut><h4>${esc(c.title)}</h4><p>${nl2br(c.text)}</p></div>`).join('') + `</div>`;
    h.tolerance = () => '<div class="wf-note">All fabricated dimensions: ±5mm measurement tolerance (standard for stainless steel fabrication).</div>';
    // the signature dividers of THIS form — a body that closes with terms cards puts them inside that section, like the quote; otherwise compose() appends them
    h.sigRow = () => FC.sigRow(prep && prep.signatures, false);
    return h;
  };

  // The signature dividers (.sig-row/.sig-box/.sig-role/.sig-name): role label centred ON the line, centred upper-case name, small lines beneath.
  FC.sigRow = function (sigs, solo) {
    sigs = arr(sigs);
    if (!sigs.length) return '';
    return `<div class="sig-row${solo ? ' solo' : ''}" data-pdf-cut style="grid-template-columns:repeat(${sigs.length},1fr)">` + sigs.map((s) =>
      `<div class="sig-box"><div class="sig-role">${esc(s.role)}</div><div class="sp"></div><div class="sig-name">${esc(s.name)}</div>` +
      arr(s.lines).filter(Boolean).map((l) => `<small>${esc(l)}</small>`).join('') + `</div>`).join('') + `</div>`;
  };
  // .print-footer: navy rule, bold thanks line, grey creds line
  FC.footerHtml = (co) => `<div class="print-footer" data-pdf-cut><div class="pf-thanks">${esc(co.thanks)}</div><div class="pf-creds">${esc(co.creds)}</div></div>`;

  // The Google-review QR footer option (§9.9 owner ruling 2026-11-19): a registry entry with `reviewQr: true` gets the QR and ONE plain line above the
  // thanks/creds footer. The QR is made here from the vendored encoder (js/qrcode.js → window.buildQRSVG, inline SVG): no network, so it works offline and
  // in the PDF. Entries that need it list 'js/qrcode.js' in `needs`. Without the encoder the plain line and the address still print.
  FC.REVIEW_URL = 'https://g.page/r/CTfy7v-fDzwEEBM/review';
  FC.REVIEW_LINE = 'Happy with our work? Scan to leave us a Google review.';
  FC.reviewQrHtml = function () {
    let svg = '';
    try { if (typeof W().buildQRSVG === 'function') svg = String(W().buildQRSVG(FC.REVIEW_URL, 84) || ''); } catch (_) { svg = ''; }
    return `<div class="review-qr" data-pdf-cut style="margin-top:10px;text-align:center;page-break-inside:avoid;break-inside:avoid">` +
      (svg ? `<div class="rq-code" style="display:inline-block;line-height:0">${svg}</div>` : '') +
      `<div class="rq-line" style="font-size:9pt;font-weight:600;color:#1F3A5F;margin-top:3px">${esc(FC.REVIEW_LINE)}</div>` +
      `<div class="rq-url" style="font-size:7.5pt;color:#6B7280">${esc(FC.REVIEW_URL)}</div></div>`;
  };

  // The sheet CSS. Rooted at .pd-print .frm so nothing leaks into the live app; every size is the quote's print size (pt), the colours its
  // palette (--dark-blue #1E3A5F, --mid-blue #2E5F8A, --light-blue #D6E4F0, --gray-light #F5F6FA, --gray-mid #DDE2EC, --gray-dark #6B7280).
  FC.CSS = `
.pd-print.page{width:210mm;min-height:297mm;margin:0 auto;background:#fff;padding:11mm 10mm 7mm;color:#000}
.pd-print .frm{font-family:'Segoe UI',system-ui,-apple-system,Arial,sans-serif;font-size:9pt;line-height:1.35;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.pd-print .frm .fh-header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:8px;padding-bottom:7px;border-bottom:2.5px solid #1F3A5F}
.pd-print .frm .fh-id{flex:1 1 auto;min-width:0}
.pd-print .frm .fh-logo{display:block;height:56px;width:auto;max-width:none;margin:-10.64px 0 -10.64px -14.45px}
.pd-print .frm .fh-co{margin-top:1.5mm;font-size:8pt;line-height:1.45;color:#444}
.pd-print .frm .fh-co span{white-space:nowrap}
.pd-print .frm .fh-doc{text-align:right;flex:none}
.pd-print .frm .fh-brand{display:flex;align-items:center;gap:9px}
.pd-print .frm .fh-mark{display:block;width:48px;height:48px;flex:none}
.pd-print .frm .fh-name{font-size:16pt;font-weight:900;color:#1F3A5F;letter-spacing:1.5px;line-height:1.1;white-space:nowrap}
.pd-print .frm .cd{color:#777;font-size:7.5pt;font-weight:600;margin-right:5px;letter-spacing:.3px}
.pd-print .frm .fh-legal{font-size:8.5pt;font-weight:600;color:#444;margin-top:1px}
.pd-print .frm .fh-title{font-size:14pt;font-weight:900;color:#1F3A5F;letter-spacing:1px;white-space:nowrap}
.pd-print .frm .fh-no{font-size:11pt;font-weight:700;color:#333;margin-top:4px}
.pd-print .frm .fh-date,.pd-print .frm .fh-meta{font-size:9.5pt;color:#555;margin-top:2px}
.pd-print .frm table{width:100%;border-collapse:collapse;table-layout:fixed}
.pd-print .frm th{background:#1F3A5F;color:#fff;text-align:left;padding:3px 6px;font-size:8pt;font-weight:700;text-transform:uppercase;letter-spacing:.5px;border:0;vertical-align:middle}
.pd-print .frm td{padding:2.5px 6px;font-size:8.5pt;border:0;border-bottom:1px solid #DDE2EC;vertical-align:middle;color:#000;word-wrap:break-word;overflow-wrap:anywhere}
.pd-print .frm th.ac,.pd-print .frm td.ac{text-align:center}
.pd-print .frm th.ar,.pd-print .frm td.ar{text-align:right}
.pd-print .frm .nm{font-weight:600}
.pd-print .frm .sp{font-size:8pt;color:#333;margin-top:1px}
.pd-print .frm .section{margin-bottom:5px;padding:3px 0 5px;border-bottom:1px solid #e3e7ef;page-break-inside:avoid;break-inside:avoid}
.pd-print .frm .section.flow{page-break-inside:auto;break-inside:auto}
.pd-print .frm .sec-title{font-size:8.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#1F3A5F;border-bottom:1.5px solid #1F3A5F;margin-bottom:4px;padding-bottom:2px;page-break-after:avoid;break-after:avoid}
.pd-print .frm .cat-row td{background:#D6E4F0;color:#1F3A5F;font-weight:700;font-size:7.5pt;text-transform:uppercase;letter-spacing:.5px;padding:2.5px 6px;border-bottom:0;page-break-after:avoid;break-after:avoid}
.pd-print .frm .subtotal-row td{background:#f0f4ff;color:#1F3A5F;font-weight:700;font-size:8pt;text-align:right;padding:2.5px 6px;border-bottom:2px solid #2E5F8A}
.pd-print .frm tr{page-break-inside:avoid;break-inside:avoid}
.pd-print .frm .totals-box{display:flex;justify-content:flex-end;margin-top:4px;page-break-inside:avoid;break-inside:avoid}
.pd-print .frm .totals-tbl{width:48%;margin-left:auto}
.pd-print .frm .totals-tbl td{font-size:9pt;padding:2.5px 8px;border-bottom:0;text-align:right}
.pd-print .frm .totals-tbl td:first-child{text-align:left}
.pd-print .frm .totals-tbl tr.grand td{font-weight:700;font-size:10.5pt;border-top:2px solid #1F3A5F;padding-top:7px}
.pd-print .frm .totals-tbl tr.discount td{color:#E74C3C}
.pd-print .frm .totals-tbl tr.cur-note td{font-size:10px;color:#6B7280;font-weight:400;text-align:right;padding-top:1px}
.pd-print .frm .pay-tbl{margin-top:4px}
.pd-print .frm .pay-tbl td{padding:2px 6px;font-size:8pt;border-bottom:1px solid #DDE2EC;vertical-align:top}
.pd-print .frm .pay-tbl td:last-child{text-align:right;font-weight:600}
.pd-print .frm .pay-tbl tr.pay-head td{background:#D6E4F0;font-weight:700;color:#1F3A5F}
.pd-print .frm .pay-note{font-size:7.5pt;color:#6B7280;margin-top:6px;line-height:1.5;font-style:italic}
.pd-print .frm .f-text{font-size:8.5pt;line-height:1.4;margin-top:2px}
.pd-print .frm .bill-strip{margin-bottom:6px;background:#F5F6FA;border:1px solid #DDE2EC;border-radius:5px;padding:5px 9px;font-size:8.5pt;line-height:1.4;page-break-inside:avoid;break-inside:avoid}
.pd-print .frm .f-proj{color:#666}
.pd-print .frm .terms-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px 14px}
.pd-print .frm .terms-block{background:#F5F6FA;border-radius:7px;padding:4px 8px;page-break-inside:avoid;break-inside:avoid}
.pd-print .frm .terms-block.full{grid-column:1/-1}
.pd-print .frm .terms-block h4{font-size:8pt;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#2E5F8A;margin-bottom:2px}
.pd-print .frm .terms-block p{font-size:7.8pt;color:#1A1F2E;line-height:1.3}
.pd-print .frm .wf-note{font-size:8pt;color:#333;margin-top:4px}
.pd-print .frm .sig-row{display:grid;gap:28px;margin-top:10px;page-break-inside:avoid;break-inside:avoid}
.pd-print .frm .sig-row.solo{margin-top:18px}
.pd-print .frm .sig-box{border-top:1.5px solid #DDE2EC;padding-top:8px;text-align:center;position:relative}
.pd-print .frm .sig-role{position:absolute;top:-9px;left:50%;transform:translateX(-50%);background:#fff;padding:0 8px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#2E5F8A;white-space:nowrap}
.pd-print .frm .sig-box .sp{height:24px}
.pd-print .frm .sig-name{font-weight:700;font-size:14px;text-transform:uppercase;min-height:17px}
.pd-print .frm .sig-box small{color:#6B7280;font-size:11px;line-height:1.5;display:block}
.pd-print .frm .print-footer{margin-top:8px;padding-top:8px;border-top:2px solid #1F3A5F;text-align:center;page-break-inside:avoid;break-inside:avoid}
.pd-print .frm .pf-thanks{font-size:10pt;font-weight:700;color:#1F3A5F;margin-bottom:3px}
.pd-print .frm .pf-creds{font-size:8pt;color:#666;line-height:1.5}
@media print{
  @page{size:A4 portrait;margin:11mm 10mm 7mm;}
  body{background:#fff!important;}
  .pd-print.page{padding:0;width:auto;min-height:0}
  .pd-print .frm thead{display:table-header-group}
  .pd-print .frm th{background:#1F3A5F!important;color:#fff!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .pd-print .frm .section{page-break-inside:avoid}
  .pd-print .frm .section.flow{page-break-inside:auto}
}`;

  // The whole page: the header (horizontal logo + company line at the left; BK tile, title, number, date and references at the right), the body's
  // sections, signature dividers, thanks/creds footer.
  FC.compose = function (prep, sections) {
    const co = prep.co;
    const mid = Array.isArray(sections) ? sections.join('') : String(sections || '');
    const title = FC.titleCase(prep.title) + ' — ' + prep.numberText;
    return {
      title, barLabelText: title, fileName: prep.fileName, watermark: prep.watermark || null, accent: prep.accent,
      pageId: 'frm-page',
      bodyHtml: `<div class="frm">${FC.headerHtml(prep)}${mid}${mid.indexOf('class="sig-row') >= 0 ? '' : FC.sigRow(prep.signatures, !!prep.entry.sigSolo)}${prep.entry.reviewQr ? FC.reviewQrHtml() : ''}${FC.footerHtml(co)}</div>`,
      pageCss: FC.CSS,
    };
  };
  // Runs the registered body (js/forms-set-1.js) for a prepared form → string[] or throws.
  FC.renderSections = function (prep) {
    const bodies = W().FormsBodies || {};
    const fn = bodies[prep.id];
    if (typeof fn !== 'function') throw makeError('no-body', `No body renderer is loaded for "${prep.id}".`);
    const out = fn(prep.data, FC.makeHelpers(prep.entry, prep));
    return Array.isArray(out) ? out : [String(out == null ? '' : out)];
  };

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════
  //  RECORDS + NUMBER ASSIGNMENT (db is INJECTED: js/forms.js passes the app's `db`, tests pass a fake)
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════
  const isClaimDoc = (d) => !!d && (!!d.orderId || ['balance', 'progress', 'change_order', 'site_visit'].indexOf(d.kind) >= 0);
  // Reads what the form needs, fresh: sales_orders → projectId → job_projects (§9.3). `ref.record` / `ref.order` / `ref.project` / `ref.claim` are
  // already-loaded docs (no read). A missing REQUIRED record throws code 'not-found'; optional ones are read softly.
  FC.loadRecords = async function (db, entry, ref) {
    ref = ref || {};
    const need = entry.records || {};
    const get = async (coll, id) => { if (!id) return null; const s = await db.collection(coll).doc(String(id)).get(); return s.exists ? Object.assign({ id: s.id }, s.data()) : null; };
    const soft = async (coll, id) => { try { return await get(coll, id); } catch (_) { return null; } };
    const src = entry.source && entry.source.coll;
    let order = ref.order || null, project = ref.project || null, claim = ref.claim || null;
    if (ref.record) {
      if (src === 'job_projects') project = project || ref.record;
      else if (src === 'payment_claims' || (entry.id === 'payment_ack' && isClaimDoc(ref.record))) claim = claim || ref.record;
      else order = order || ref.record;
    }
    if (!claim && ref.claimId && need.claim) claim = await (need.claim === 'required' && !need.order ? get : soft)('payment_claims', ref.claimId);
    if (!order && (ref.orderId || (claim && claim.orderId)) && need.order) order = await (need.order === 'required' && !claim ? get : soft)('sales_orders', ref.orderId || claim.orderId);
    if (!project && need.project) {
      const pid = ref.projectId || (order && order.projectId) || (claim && claim.projectId);
      project = await (need.project === 'required' ? get : soft)('job_projects', pid);
    }
    if (!order && need.order && project && project.salesOrderId) order = await soft('sales_orders', project.salesOrderId);
    const missing = (need.order === 'required' && !order && !claim) || (need.project === 'required' && !project) || (need.claim === 'required' && !claim && !order);
    if (missing) throw makeError('not-found', 'We could not find that record.');
    return { order, project, claim };
  };

  // Stores any missing serial and returns { [formId]: number }. NEVER throws: a number that cannot be written (rules, offline, no record) comes back
  // as the entry's fallback and nothing is changed. The counter bump and the serial write are ONE transaction, so a refused write burns no number
  // and two taps cannot hand out two. Only fields the viewer may write TODAY are attempted (canStoreNumber).
  // THE PAIR: sales order and job order share one serial. When the other half already carries it, this half is stamped with THAT serial and the
  // counter is not touched; the job order is handled first, because any staff may write joNumber (a Sales login cannot write soNumber yet) — the
  // sales order then reads its number off the job.
  FC.assignWith = async function (db, formIds, ref, viewer) {
    const out = {};
    const ids = arr(formIds).slice().sort((a, b) => (a === 'job_order' ? 0 : 1) - (b === 'job_order' ? 0 : 1));
    for (const formId of ids) {
      let fallback = '';
      try {
        const entry = REG[formId];
        if (!entry || !entry.number) { out[formId] = ''; continue; }
        const spec = entry.number;
        let ctx = { order: null, project: null, claim: null };
        try { ctx = await FC.loadRecords(db, entry, ref); } catch (_) { /* fall back below */ }
        ctx.viewer = FC.viewer(viewer);
        const res = FC.resolveNumber(entry, ctx);
        if (res.number && (res.source === 'stored' || res.source === 'derived')) { out[formId] = res.number; continue; }
        fallback = res.number || (ref && (ref.orderId || ref.claimId || ref.projectId) ? String(spec.series || '') + '-' + FC.last6(ref.orderId || ref.claimId || ref.projectId) : '');
        const target = typeof spec.target === 'function' ? spec.target(ctx) : null;
        if (!target || !target.id || !spec.field || !spec.series || !FC.canStoreNumber(target.coll, spec.field, viewer)) { out[formId] = fallback; continue; }
        const pair = typeof spec.pair === 'function' ? spec.pair(ctx) : null;
        const counterRef = db.collection('_counters').doc(FC.counterName(spec.series));
        const docRef = db.collection(target.coll).doc(String(target.id));
        out[formId] = await db.runTransaction(async (t) => {
          const d = await t.get(docRef);
          if (!d.exists) return fallback;
          const cur = d.data() || {};
          if (str(cur[spec.field])) return str(cur[spec.field]);
          let serial = '';
          if (pair && pair.id) { const o = await t.get(db.collection(pair.coll).doc(String(pair.id))); if (o.exists) serial = serialOf((o.data() || {})[pair.field]); }
          if (!serial) {
            const c = await t.get(counterRef);
            const next = Math.max(0, c.exists ? Number((c.data() || {}).count) || 0 : 0) + 1;
            serial = String(next).padStart(4, '0');
            t.set(counterRef, { count: next }, { merge: true });
          }
          const number = spec.series + '-' + serial;
          t.update(docRef, { [spec.field]: number });
          return number;
        });
      } catch (_) { out[formId] = fallback; }
    }
    return out;
  };

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════
  //  PHASE 1 ENTRIES — field lists are the ONLY data that reaches a body (§9.4 step 3)
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════
  const PRODUCTION = 'js/screens/production.js';
  const joOf = (c) => (W().joDoc && c.project ? W().joDoc(c.project) : null);
  const clientName = (c) => first(c.order && c.order.clientName, c.claim && c.claim.clientName, c.project && c.project.clientName, c.client && c.client.name);
  const quoteNo = (c) => first(c.order && c.order.quoteNumber, c.claim && c.claim.quoteNumber, c.project && c.project.quoteNumber);
  const subjectOf = (c) => first(c.order && c.order.subject, c.quote && c.quote.subject, c.project && c.project.subject);
  const clientParty = (c) => ({
    company: first(c.client && c.client.company, c.order && c.order.clientCompany),
    address: first(c.client && c.client.address, c.order && c.order.clientAddress, c.project && c.project.clientAddress),
    phone: first(c.client && c.client.phone, c.order && c.order.clientPhone),
    email: first(c.client && c.client.email, c.order && c.order.clientEmail),
  });
  const preparerName = (c, ...more) => first(...more, c.preparer && c.preparer.name);
  const preparerTitle = (c, fallback) => first(c.preparer && c.preparer.title, fallback);

  // ── the shared serial: SO-0012 / JO-0012 ─────────────────────────────────────────────────────────────────
  function soInfo(c) {
    const o = c.order;
    const stored = str(o && o.soNumber);
    if (stored) return { number: stored, source: 'stored' };
    const ser = serialOf(c.project && c.project.joNumber);
    if (ser) return { number: 'SO-' + ser, source: 'pair' };
    return { number: o ? 'SO-' + FC.last6(o.id) : '', source: 'fallback' };
  }
  const joFallback = (p) => (typeof W().jobOrderNoFor === 'function' ? W().jobOrderNoFor(p) : 'JO-' + String((p && p.id) || '').slice(0, 6).toUpperCase());
  function joInfo(c) {
    const p = c.project;
    const stored = str(p && p.joNumber);
    if (stored) return { number: stored, source: 'stored' };
    const ser = serialOf(c.order && c.order.soNumber);
    if (ser) return { number: 'JO-' + ser, source: 'pair' };
    return { number: p ? joFallback(p) : '', source: 'fallback' };
  }
  const salesRev = (c) => Math.max(0, Math.floor(Number((c.order && c.order.contractRev) || (c.project && c.project.joRev)) || 0));
  // header meta lines: the quote's number as filed (quote-number style), the sales order's serial (with its revision) — only when a REAL serial exists
  const metaQuoteRef = (c) => (quoteNo(c) ? 'Quotation ref: ' + quoteNo(c) : '');
  const metaSoRef = (c, withRev) => { const i = soInfo(c); return i.source === 'fallback' || !i.number ? '' : 'Sales order ref: ' + (withRev ? FC.withRev(i.number, salesRev(c)) : i.number); };

  // ── line sections and codes (shared by every form that lists items) ─────────────────────────────────────────
  // A line's section heading, as the quote prints it: its own catLabel (a custom section), else its `category` id in words. kc1 lines (the
  // configurators, live 2026-11-20) carry only `category` ('prep', 'cook' …); most legacy catalogue lines carry only `category` too. The names
  // are the quote builder's SECTION_FALLBACK_LABELS; an id nobody knows is spelled out ("exhaust_system" → "Exhaust System").
  FC.SECTION_LABELS = Object.freeze({
    cooking_line: 'Cooking Line', prep_washing: 'Preparation & Washing', refrigeration: 'Refrigeration', baking: 'Baking', ventilation: 'Ventilation',
    exhaust_system: 'Exhaust System', fresh_air_system: 'Fresh Air System', gas_line: 'Gas Line', fire_suppression: 'Fire Suppression', miscellaneous: 'Miscellaneous',
    prep: 'Prep and storage', wash: 'Washing', cook: 'Cooking', vent: 'Ventilation', cold: 'Refrigeration', multi: 'Multi-purpose', mech: 'Mechanical Systems',
  });
  FC.sectionLabel = function (it) {
    const own = str(it && it.catLabel).trim(); if (own) return own;
    const id = str(it && it.category).trim(); if (!id) return '';
    if (Object.prototype.hasOwnProperty.call(FC.SECTION_LABELS, id)) return FC.SECTION_LABELS[id];
    return id.split(/[_\s]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  };
  // a kc1 line's model code (doc.code, e.g. "WT-1800"), printed in small grey before the name as the quotation does; '' for a legacy or custom line
  // ON: owner approved 2026-11-20 ("Yes, completr thr works", relayed by the quick-fixes session; Round 5 Q62: the price-list codes are the
  // real codes and are printed). The switch stays so a code can be taken off every form at once.
  FC.SHOW_ITEM_CODES = true;
  FC.itemCode = (it) => {
    if (!FC.SHOW_ITEM_CODES || !it) return '';
    const d = it.doc && typeof it.doc === 'object' ? it.doc : null;
    return str((d && d.code) || it.code).trim();
  };

  // ── sales_order ──────────────────────────────────────────────────────────────────────────────────────────
  // item specs: same precedence as production.js joScopeRow (edited spec text, then the spec list, then the plain string)
  function specText(it) {
    const se = it.specEdit;
    if (se !== undefined && se !== null && String(se).trim()) return String(se).trim();
    if (Array.isArray(it.specs) && it.specs.length) return it.specs.map((s) => (s && s.label ? s.label + ': ' + s.value : (s && s.value) || '')).filter(Boolean).join(' • ');
    return String(it.specStr || it.specs || '').trim();
  }
  const paymentKind = { balance: 'Balance', progress: 'Progress Payment', change_order: 'Change-Order Down Payment', site_visit: 'Site-Visit Fee' };
  function orderLines(c) {
    const o = c.order || {};
    const items = arr(o.items).length ? arr(o.items) : arr(c.project && c.project.items);
    return items.map((it) => ({ cat: FC.sectionLabel(it), code: FC.itemCode(it), name: str(it.name), dims: str(it.dims), specs: specText(it),
      qty: fin(it.qty), unit: str(it.unit) || 'pc', unitPrice: fin(it.unitPrice), amount: fin(it.amount) }));
  }
  // The quote's Subtotal / Discount / VAT ladder, printed only when it RECONCILES with the order's contract amount (a later price change would
  // otherwise leave a ladder that no longer adds up); otherwise only Subtotal (if the lines add up to the contract) and the GRAND TOTAL are printed.
  function ladderOf(c) {
    const q = c.quote, o = c.order || {};
    if (!q) return null;
    const total = fin(q.total), contract = fin(o.contractAmount), sub = fin(q.subtotal);
    if (total === null || contract === null || sub === null || Math.abs(total - contract) > 0.01) return null;
    const disc = fin(q.discountAmount) || 0, vat = q.vatIncluded ? (fin(q.vatAmount) || 0) : 0;
    if (Math.abs(sub - disc + vat - total) > 0.5) return null;
    const rows = [{ label: 'Subtotal', amt: sub }];
    if (disc > 0) rows.push({ label: 'Discount' + (fin(q.discountPct) ? ` (${fin(q.discountPct)}%)` : ''), amt: -disc, cls: 'discount' });
    if (vat > 0) rows.push({ label: 'VAT (12%)', amt: vat });
    return rows;
  }
  const dpPct = (c) => {
    const raw = c.project && c.project.dpPercent !== undefined && c.project.dpPercent !== null ? c.project.dpPercent : c.order && c.order.dpPercent;
    const v = fin(raw);
    return v && v > 0 ? v : null;
  };
  function paymentsOf(c) {
    const p = c.project || {}, o = c.order || {};
    const lab = (x) => (/sales order/i.test(str(x.type)) ? 'Down Payment' : str(x.type) || 'Payment');
    let list = arr(p.payments).map((x) => ({ label: lab(x), date: FC.toIsoDate(x.date), method: str(x.method), reference: str(x.orRef), pa: '', amount: fin(x.amount) }));
    if (!list.length && str(o.status) === 'recorded' && fin(o.recordedAmount) !== null) {
      list = [{ label: 'Down Payment', date: FC.toIsoDate(o.paymentDate || o.recordedAt), method: str(o.paymentMethod), reference: str(o.orRef), pa: '', amount: fin(o.recordedAmount) }];
    }
    if (list.length && str(o.paNumber)) list[0].pa = str(o.paNumber);        // the first payment is the order's own: its acknowledgement number
    return list;
  }
  const collectedOf = (c) => { const p = c.project || {}; return fin(p.amountCollected) !== null ? fin(p.amountCollected) : paymentsOf(c).reduce((s, x) => s + (x.amount || 0), 0); };
  // an EARLIER revision is only printable where the order kept it (revisions[], Phase 2); its contract and balance are the recorded ones
  const contractOf = (c) => (c.revEntry && fin(c.revEntry.toAmount) !== null ? fin(c.revEntry.toAmount) : fin(c.order && c.order.contractAmount));
  const balanceOf = (c) => {
    if (c.revEntry && fin(c.revEntry.arAfter) !== null) return fin(c.revEntry.arAfter);
    const p = c.project || {};
    if (fin(p.arBalance) !== null) return fin(p.arBalance);
    const ct = contractOf(c);
    return ct === null ? null : Math.max(0, ct - collectedOf(c));
  };
  // how the quote says the balance is paid (payment.balanceMode: lump | stagger3-5 | install3-12)
  function balanceTerms(c) {
    const m = str(c.quote && c.quote.payment && c.quote.payment.balanceMode);
    let k;
    if (m === 'lump') return 'payable in full upon completion';
    if ((k = /^stagger(\d+)$/.exec(m))) return `payable in ${k[1]} staggered payments during the project`;
    if ((k = /^install(\d+)$/.exec(m))) return `payable in ${k[1]} monthly instalments`;
    return '';
  }
  function timelineOf(c) {
    const t = (c.quote && c.quote.timeline) || {}, j = (c.project && c.project.jobOrder) || {};
    const lead = fin(t.leadDays);
    return { start: FC.toIsoDate(first(t.startDate, j.startDate)), lead: lead ? `${lead} calendar days` : '', completion: FC.toIsoDate(first(t.completionDate, c.order && c.order.targetDate, c.project && c.project.targetDate)) };
  }
  const orderDate = (c) => (c.order && (c.order.releasedAt || c.order.createdAt)) || (c.project && c.project.createdAt) || '';
  const revisionRows = (c) => arr(c.order && c.order.revisions).map((r) => ({ rev: 'R' + Math.floor(Number(r.revNo) || 0), date: FC.toIsoDate(r.decidedAt), reason: str(r.changeReason || r.reason), delta: fin(r.delta) }));

  FC.register({
    id: 'sales_order', title: 'SALES ORDER', audience: 'sales', orientation: 'portrait', bodySet: 'js/forms-set-1.js',
    source: { coll: 'sales_orders', via: 'orderId' }, records: { order: 'required', project: 'optional' }, needs: [],
    number: { series: 'SO', coll: 'sales_orders', field: 'soNumber', label: 'SO No.', revField: 'contractRev',
      record: (c) => c.order, target: (c) => ({ coll: 'sales_orders', id: c.order && c.order.id }),
      pair: (c) => ({ coll: 'job_projects', id: (c.project && c.project.id) || (c.order && c.order.projectId), field: 'joNumber' }),
      resolve: soInfo, fallback: (o) => 'SO-' + FC.last6(o && o.id) },
    signatures: ['prepared', 'approved', 'conforme'],
    date: orderDate,
    revisionDate: (c, rev) => {
      if (c.revEntry && c.revEntry.decidedAt) return c.revEntry.decidedAt;
      const hit = arr(c.order && c.order.revisions).filter((r) => Number(r.revNo) === rev)[0];
      return hit ? hit.decidedAt : '';
    },
    revisionOf: (c, rev, cur) => {
      const o = c.order || {};
      if (rev < 0 || rev >= cur) return null;
      const hit = arr(o.revisions).filter((r) => Number(r.revNo) === rev)[0];
      if (hit) return hit;
      if (rev === 0 && fin(o.originalContractAmount) !== null) return { revNo: 0, toAmount: o.originalContractAmount, decidedAt: o.createdAt };
      return null;
    },
    extraMeta: (c) => [metaQuoteRef(c)],
    guard: (c) => (c.order ? '' : 'We could not find that order.'),
    sign: (c, d, co) => [
      { role: 'Prepared by', name: preparerName(c, c.order && c.order.createdByName), lines: [preparerTitle(c, 'Sales')] },
      { role: FC.LABELS.approvedBy, name: co.sig.name, lines: [co.sig.title] },
      { role: 'Conforme — Accepted by Client', name: d.clientName || 'CLIENT NAME', lines: ['Signature over printed name', 'Date: ___________________'] },
    ],
    fields: [
      { key: 'clientName', label: 'Client', from: (c) => clientName(c) },
      { key: 'clientCompany', label: 'Company', from: (c) => clientParty(c).company },
      { key: 'clientAddress', label: 'Address', from: (c) => clientParty(c).address },
      { key: 'clientPhone', label: 'Phone', from: (c) => clientParty(c).phone },
      { key: 'clientEmail', label: 'E-mail', from: (c) => clientParty(c).email },
      { key: 'subject', label: 'Subject', from: subjectOf },
      { key: 'quoteRef', label: 'Quotation ref', from: quoteNo },
      { key: 'lines', label: 'Items', money: true, list: true, from: orderLines },
      { key: 'ladder', label: 'Totals ladder', money: true, list: true, from: ladderOf },
      { key: 'contract', label: 'Contract amount', money: true, from: contractOf },
      { key: 'revTag', label: 'Revision', from: (c) => (c.rev > 0 ? 'R' + c.rev : '') },
      { key: 'payments', label: 'Payments received', money: true, list: true, from: paymentsOf },
      { key: 'dpPercent', label: 'Down payment %', from: dpPct },
      { key: 'collected', label: 'Collected', money: true, from: collectedOf },
      { key: 'credited', label: 'Credited site-visit fee', money: true, from: (c) => paymentsOf(c).filter((x) => /site-visit fee/i.test(x.label)).reduce((s, x) => s + (x.amount || 0), 0) },
      { key: 'balance', label: 'Balance due', money: true, from: balanceOf },
      { key: 'balanceTerms', label: 'Balance terms', from: balanceTerms },
      { key: 'vatNote', label: 'VAT note', money: true, from: (c) => (c.quote && c.quote.vatIncluded === true ? 'VAT included' : c.quote && c.quote.vatIncluded === false ? 'VAT exclusive' : '') },
      { key: 'timeline', label: 'Project timeline', from: timelineOf },
      { key: 'revisions', label: 'Revision history', money: true, list: true, from: revisionRows },
    ],
  });

  // ── job_order (workforce copy: no prices) ────────────────────────────────────────────────────────────────
  const workOrderNos = (c) => arr(c.workOrders).map((o) => str(o.orderNo)).filter(Boolean);
  const projDate = (c) => (c.project && (c.project.releasedAt || c.project.createdAt)) || '';
  // the money-free scope lines: joScopeRow() already names its keys; only what a workforce copy prints is taken
  function crewLines(c) {
    const j = joOf(c);
    // joDoc's rows are joScopeRow(source[i]) one for one (production.js joScopeOf): the source line gives the section and the code that
    // joScopeRow does not carry. An edited job order's saved rows have no category, so the quote's line of the same name stands in.
    const p = c.project || {}, jo = p.jobOrder || {};
    const saved = arr(jo.items).length ? arr(jo.items) : null, quoteRows = arr(p.items);
    const srcOf = (i, name) => {
      const s = saved ? saved[i] : quoteRows[i];
      if (s && (FC.sectionLabel(s) || FC.itemCode(s))) return s;
      return quoteRows.find((q) => q && str(q.name).trim() === str(name).trim()) || s || {};
    };
    return arr(j && j.items).map((it, i) => {
      const s = srcOf(i, it.name);
      return { name: it.name, specs: it.specs, dims: it.dims, qty: it.qty, unit: it.unit, location: it.location, adjustment: it.adjustment, notes: it.notes,
        catLabel: str(it.catLabel).trim() || FC.sectionLabel(s), code: FC.itemCode(s) };
    });
  }
  function crewDrawings(c) {
    return arr(c.drawings).filter((d) => str(d.status) === 'released').map((d) => ({ title: first(d.title, d.number) || 'Drawing', rev: first(d.currentRev) || 'A' }));
  }
  const clientDrawingOf = (c) => {
    const hd = (c.project && c.project.handoffDrawing) || (c.order && c.order.handoffDrawing);
    return hd ? first(typeof hd === 'string' ? hd : hd.name, 'Client-supplied drawing') : '';
  };
  // Revision history of the job order: the number and date of each revision and a note in plain words — never a reason or an amount (those are
  // the Sales order's). joRevNote (written with the revision, "no pesos" by spec) is the latest note; earlier ones read the standard sentence.
  const JO_REV_NOTE = 'Contract revised by Sales. Items and dimensions are unchanged unless a change order is listed above.';
  function crewRevisions(c) {
    const rows = revisionRows(c).map((r) => ({ rev: r.rev, date: r.date, note: JO_REV_NOTE }));
    const p = c.project || {}, n = Math.floor(Number(p.joRev) || 0);
    if (n > 0 && (!rows.length || rows[rows.length - 1].rev !== 'R' + n)) rows.push({ rev: 'R' + n, date: FC.toIsoDate(p.joRevAt), note: first(p.joRevNote) || JO_REV_NOTE });
    else if (n > 0 && str(p.joRevNote)) rows[rows.length - 1].note = str(p.joRevNote);
    return rows;
  }

  FC.register({
    id: 'job_order', title: 'JOB ORDER', audience: 'ops', orientation: 'portrait', bodySet: 'js/forms-set-1.js', sigSolo: true,
    source: { coll: 'job_projects', via: 'projectId' }, records: { project: 'required', order: 'optional' }, needs: [PRODUCTION],
    number: { series: 'JO', coll: 'job_projects', field: 'joNumber', label: 'JO No.', revField: 'joRev',
      record: (c) => c.project, target: (c) => ({ coll: 'job_projects', id: c.project && c.project.id }),
      pair: (c) => ({ coll: 'sales_orders', id: (c.order && c.order.id) || (c.project && c.project.salesOrderId), field: 'soNumber' }),
      resolve: joInfo, fallback: joFallback },
    signatures: ['prepared', 'approved', 'received'],
    date: projDate,
    revisionDate: (c) => (c.project && c.project.joRevAt) || '',
    revisionOf: () => null,                       // a job order keeps no per-revision snapshot: only the current one prints
    extraMeta: (c) => ['WORKFORCE COPY — NO PRICES', metaQuoteRef(c), metaSoRef(c, true)],
    guard: (c) => (c.project ? '' : 'We could not find that job.'),
    sign: (c, d, co) => [
      { role: 'Prepared by', name: preparerName(c, c.project && c.project.createdByName), lines: [preparerTitle(c, 'Sales')] },
      { role: FC.LABELS.approvedBy, name: co.sig.name, lines: [co.sig.title] },
      { role: 'Received by', name: first(c.project && c.project.acknowledgedBy), lines: ['Production'] },
    ],
    fields: [
      { key: 'clientName', label: 'Client', from: (c) => first(c.project.clientName, c.client && c.client.name) },
      { key: 'clientCompany', label: 'Company', from: (c) => clientParty(c).company },
      { key: 'clientAddress', label: 'Address', from: (c) => clientParty(c).address },
      { key: 'clientPhone', label: 'Phone', from: (c) => clientParty(c).phone },
      { key: 'clientEmail', label: 'E-mail', from: (c) => clientParty(c).email },
      { key: 'subject', label: 'Subject', from: subjectOf },
      { key: 'lines', label: 'Job order items', list: true, from: crewLines },
      { key: 'startDate', label: 'Start date (basis)', from: (c) => FC.toIsoDate((joOf(c) || {}).startDate) },
      { key: 'deliveryDate', label: 'Delivery date', from: (c) => FC.toIsoDate((joOf(c) || {}).deliveryDate) },
      { key: 'deadline', label: 'Deadline', from: (c) => FC.toIsoDate((joOf(c) || {}).targetDate) },
      { key: 'siteAddress', label: 'Delivery & installation site', from: (c) => (joOf(c) || {}).siteAddress },
      { key: 'workOrders', label: 'Work orders', list: true, from: workOrderNos },
      { key: 'drawings', label: 'Released drawings', list: true, from: crewDrawings },
      { key: 'clientDrawing', label: 'Client-supplied drawing', from: clientDrawingOf },
      { key: 'standing', label: 'Standing instructions', list: true, from: (c) => arr((joOf(c) || {}).standing).map(str).filter(Boolean) },   // the house list incl. the 12-month warranty, as on the old printJobOrder sheet
      { key: 'instructions', label: 'Special requests', freeText: true, from: (c) => (joOf(c) || {}).instructions },
      { key: 'salesNotes', label: 'Notes from Sales / Design', freeText: true, from: (c) => str(c.project && c.project.notes) },
      { key: 'revisions', label: 'Revision history', list: true, from: crewRevisions },
    ],
  });

  // ── payment_ack (only for a confirmed payment) ───────────────────────────────────────────────────────────
  const payRec = (c) => c.claim || c.order;
  const confirmOf = (c) => (payRec(c) && payRec(c).paymentConfirm) || {};
  const roleText = (r) => ({ president: 'President', finance: 'Finance', manager: 'Manager', secretary: 'Corporate Secretary', employee: 'Staff' }[str(r).toLowerCase()] || str(r));
  function paymentEntryFor(c) {
    const list = arr(c.project && c.project.payments);
    if (c.claim) return list.filter((x) => x.claimId === c.claim.id)[0] || null;
    const oid = str(c.order && c.order.id);
    return list.filter((x) => oid && str(x.ledgerId).indexOf(oid) >= 0)[0] || list.filter((x) => /sales order/i.test(str(x.type)))[0] || list[0] || null;
  }
  const amountOf = (c) => (fin(payRec(c).recordedAmount) !== null ? fin(payRec(c).recordedAmount) : fin((paymentEntryFor(c) || {}).amount));
  // "paid to date" and "balance" AS OF THIS PAYMENT: a claim carries its own snapshot (balanceAfter / collectedAfter); the order's first payment is
  // the amount itself against the contract.
  function paidToDate(c) {
    if (c.claim) { if (fin(c.claim.collectedAfter) !== null) return fin(c.claim.collectedAfter); return c.project ? fin(c.project.amountCollected) : null; }
    return amountOf(c);
  }
  function balanceDue(c) {
    if (c.claim) { if (fin(c.claim.balanceAfter) !== null) return fin(c.claim.balanceAfter); return c.project ? fin(c.project.arBalance) : null; }
    const ct = fin(c.order && c.order.contractAmount), amt = amountOf(c);
    return ct === null || amt === null ? null : Math.max(0, ct - amt);
  }

  FC.register({
    id: 'payment_ack', title: 'PAYMENT ACKNOWLEDGEMENT', audience: 'sales', orientation: 'portrait', bodySet: 'js/forms-set-1.js',
    source: { coll: 'sales_orders', via: 'orderId' }, records: { order: 'required', project: 'optional', claim: 'optional' }, needs: [],
    number: { series: 'PA', coll: 'sales_orders', field: 'paNumber', label: 'PA No.', record: payRec,
      target: (c) => (c.claim ? { coll: 'payment_claims', id: c.claim.id } : { coll: 'sales_orders', id: c.order && c.order.id }),
      fallback: (r) => 'PA-' + FC.last6(r && r.id) },
    signatures: ['prepared', 'approved', 'received'],
    date: (c) => { const cf = confirmOf(c), r = payRec(c) || {}; return cf.decidedAt || r.recordedAt || r.paymentDate || ''; },
    extraMeta: (c) => [metaSoRef(c, false), metaQuoteRef(c)],
    guard: (c) => {
      const r = payRec(c);
      if (!r) return 'We could not find that payment.';
      return str(r.status) === 'recorded' ? '' : 'This payment has not been confirmed yet, so there is no acknowledgement to issue.';
    },
    sign: (c, d) => {
      const cf = confirmOf(c), r = payRec(c) || {};
      const who = first(cf.requestedByName, r.createdByName);
      const conf = first(cf.decidedByName, r.recordedBy);
      const confLines = [cf.onBehalf ? roleText(cf.decidedByRole || 'finance') + ', for the President' : roleText(cf.decidedByRole || 'finance'), cf.decidedAt ? 'Confirmed ' + FC.longDate(FC.toIsoDate(cf.decidedAt)) : ''];
      return [
        { role: 'Received by', name: who, lines: [c.preparer && c.preparer.name === who ? preparerTitle(c, 'Sales') : 'Sales'] },
        { role: 'Confirmed by', name: conf, lines: confLines },
        { role: 'Client copy — Acknowledged by', name: d.clientName || 'CLIENT NAME', lines: ['Signature over printed name', 'Date: ___________________'] },
      ];
    },
    fields: [
      { key: 'clientName', label: 'Received from', from: (c) => clientName(c) },
      { key: 'clientCompany', label: 'Company', from: (c) => clientParty(c).company },
      { key: 'clientAddress', label: 'Address', from: (c) => clientParty(c).address },
      { key: 'clientPhone', label: 'Phone', from: (c) => clientParty(c).phone },
      { key: 'clientEmail', label: 'E-mail', from: (c) => clientParty(c).email },
      { key: 'subject', label: 'Subject', from: subjectOf },
      { key: 'quoteRef', label: 'Quotation ref', from: quoteNo },
      { key: 'soRef', label: 'Sales order ref', from: (c) => { const i = soInfo(c); return i.source === 'fallback' ? '' : i.number; } },
      { key: 'kindLabel', label: 'Payment for', from: (c) => (c.claim ? paymentKind[str(c.claim.kind)] || 'Payment' : 'Down Payment') },
      { key: 'dpPercent', label: 'Down payment %', from: (c) => (c.claim ? null : dpPct(c)) },
      { key: 'amount', label: 'Amount received', money: true, from: amountOf },
      { key: 'method', label: 'Payment method', from: (c) => first(payRec(c).paymentMethod, (paymentEntryFor(c) || {}).method) },
      { key: 'reference', label: 'Reference no.', from: (c) => first(payRec(c).orRef, (paymentEntryFor(c) || {}).orRef) },
      { key: 'paidOn', label: 'Date received', from: (c) => FC.toIsoDate(payRec(c).paymentDate || (paymentEntryFor(c) || {}).date || payRec(c).recordedAt) },
      { key: 'contract', label: 'Total contract price', money: true, from: (c) => fin(c.order && c.order.contractAmount) },
      { key: 'paidToDate', label: 'Total paid to date', money: true, from: paidToDate },
      { key: 'balanceDue', label: 'Balance due', money: true, from: balanceDue },
      { key: 'notice', label: 'Notice', from: () => FC.NOT_RECEIPT_NOTE },
    ],
  });

  // ── handoff_pack (workforce copy: no prices — SF8) ───────────────────────────────────────────────────────
  FC.register({
    id: 'handoff_pack', title: 'HANDOFF PACK', audience: 'ops', orientation: 'portrait', bodySet: 'js/forms-set-1.js', sigSolo: true,
    source: { coll: 'job_projects', via: 'projectId' }, records: { project: 'required', order: 'optional' }, needs: [PRODUCTION],
    number: { series: 'HP', record: (c) => c.project, derive: (c) => 'HP-' + joInfo(c).number },
    signatures: ['prepared', 'received'],
    date: (c) => (c.project && (c.project.releasedAt || c.project.createdAt)) || '',
    extraMeta: (c) => ['WORKFORCE COPY — NO PRICES', metaQuoteRef(c), metaSoRef(c, true), 'Job order ref: ' + FC.withRev(joInfo(c).number, salesRev(c))],
    guard: (c) => (c.project ? '' : 'We could not find that job.'),
    sign: (c) => [
      { role: 'Prepared by', name: preparerName(c, c.order && c.order.createdByName, c.project && c.project.createdByName), lines: [preparerTitle(c, 'Sales')] },
      { role: 'Received by', name: first(c.project && c.project.acknowledgedBy), lines: ['Operations'] },
    ],
    fields: [
      { key: 'clientName', label: 'Client', from: (c) => first(c.project.clientName, c.client && c.client.name) },
      { key: 'clientCompany', label: 'Company', from: (c) => clientParty(c).company },
      { key: 'contactAddress', label: 'Address', from: (c) => clientParty(c).address },
      { key: 'contactPhone', label: 'Phone', from: (c) => clientParty(c).phone },
      { key: 'contactEmail', label: 'E-mail', from: (c) => clientParty(c).email },
      { key: 'subject', label: 'Subject', from: subjectOf },
      { key: 'jobOrderNo', label: 'Job order', from: (c) => FC.withRev(joInfo(c).number, salesRev(c)) },
      { key: 'releasedOn', label: 'Released to production', from: (c) => FC.toIsoDate(c.project.releasedAt) },
      { key: 'startDate', label: 'Start date (basis)', from: (c) => FC.toIsoDate((joOf(c) || {}).startDate) },
      { key: 'deliveryDate', label: 'Delivery date', from: (c) => FC.toIsoDate((joOf(c) || {}).deliveryDate) },
      { key: 'deadline', label: 'Deadline', from: (c) => FC.toIsoDate((joOf(c) || {}).targetDate) },
      { key: 'priority', label: 'Priority', from: (c) => str(c.project.priority) },
      { key: 'siteAddress', label: 'Delivery & installation site', from: (c) => (joOf(c) || {}).siteAddress },
      { key: 'workOrders', label: 'Work orders', list: true, from: workOrderNos },
      { key: 'lines', label: 'Scope of work', list: true, from: crewLines },
      { key: 'drawings', label: 'Released drawings', list: true, from: crewDrawings },
      { key: 'drawingsHeld', label: 'Drawings not yet released', from: (c) => arr(c.drawings).filter((d) => str(d.status) !== 'released').length },
      { key: 'clientDrawing', label: 'Client-supplied drawing', from: clientDrawingOf },
      { key: 'instructions', label: 'Special requests', freeText: true, from: (c) => (joOf(c) || {}).instructions },
      { key: 'salesNotes', label: 'Notes from Sales / Design', freeText: true, from: (c) => str(c.project.notes) },
    ],
  });


  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════
  //  PHASE 4B ENTRIES — the five Operations forms (bodies: js/forms-set-2.js). ALL audience 'ops' = NO PESOS for any login.
  //  Every one prints correctly as a BLANK paper form from the job alone (job no., client, site, the job order's item lines, empty boxes / lines /
  //  signature blocks) and prints what is recorded when these fields exist (the screens that fill them are js/screens/flow-docs.js, later):
  //    job_projects.jobOrder.qcTicks[]       index-aligned to joDoc().qcChecks:      { label, state:'pass'|'fail'|'na', note?, by?, date? }
  //    job_projects.jobOrder.qcNotes         string
  //    job_projects.jobOrder.installTicks[]  index-aligned to joDoc().installChecks: { label, done:true, note?, by?, date? }
  //    job_projects.jobOrder.installNotes    string
  //    production_orders[].qc                (exists today) { result:'passed'|'failed', items:[{label,state}], notes, byName, at } — via ctx.workOrders
  //    job_projects.punchList                { items:[{ text, location?, raisedDate?, done?, doneDate?, by? }], clearedAt?, clearedBy? }  (array also read)
  //    job_projects.acceptance               { url?, name?, signedBy, date, by, byName, at }
  //  A tick only applies while its `label` still equals the list's label at that index (an edited list never shows a stale tick).
  //  Numbers: QC-/INS-/PL-/ACC- + the job order number, DERIVED like HP- (no counters). delivery_receipt keeps its stored DR serial.
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════
  const jobNoText = (c) => FC.withRev(joInfo(c).number, salesRev(c));
  const jobMeta = (c) => [metaQuoteRef(c), 'Job order ref: ' + jobNoText(c)];
  const jobGuard = (c) => (c.project ? '' : 'We could not find that job.');
  const jobSource = { source: { coll: 'job_projects', via: 'projectId' }, records: { project: 'required', order: 'optional' }, needs: [PRODUCTION] };
  const jobFields = () => [
    { key: 'clientName', label: 'Client', from: (c) => first(c.project.clientName, c.client && c.client.name) },
    { key: 'clientCompany', label: 'Company', from: (c) => clientParty(c).company },
    { key: 'clientAddress', label: 'Address', from: (c) => clientParty(c).address },
    { key: 'clientPhone', label: 'Phone', from: (c) => clientParty(c).phone },
    { key: 'clientEmail', label: 'E-mail', from: (c) => clientParty(c).email },
    { key: 'subject', label: 'Subject', from: subjectOf },
    { key: 'jobOrderNo', label: 'Job order', from: jobNoText },
    { key: 'siteAddress', label: 'Delivery & installation site', from: (c) => (joOf(c) || {}).siteAddress },
    { key: 'deliveryDate', label: 'Delivery date', from: (c) => FC.toIsoDate((joOf(c) || {}).deliveryDate) },
    { key: 'deadline', label: 'Deadline', from: (c) => FC.toIsoDate((joOf(c) || {}).targetDate) },
    { key: 'workOrders', label: 'Work orders', list: true, from: workOrderNos },
    { key: 'lines', label: 'Job order items', list: true, from: crewLines },
  ];
  const joRaw = (c) => (c.project && c.project.jobOrder) || {};
  // a check list (strings) merged with its index-aligned ticks → [{ label, state, done, note, by, date }]
  function tickedChecks(labels, ticks) {
    const t = arr(ticks);
    return arr(labels).map((l, i) => {
      const label = str(l && typeof l === 'object' ? (l.label || l.text) : l);
      const k = t[i] && typeof t[i] === 'object' && (!str(t[i].label) || str(t[i].label) === label) ? t[i] : {};
      return { label, state: str(k.state).toLowerCase(), done: k.done === true, note: str(k.note), by: str(k.by || k.byName), date: FC.toIsoDate(k.date || k.doneDate || k.at) };
    }).filter((r) => r.label);
  }
  const qcOf = (o) => (o && o.qc && typeof o.qc === 'object' ? o.qc : null);
  function workOrderQc(c) {
    return arr(c.workOrders).filter(qcOf).map((o) => {
      const q = qcOf(o);
      return { orderNo: str(o.orderNo), title: str(o.title), result: str(q.result).toLowerCase(), byName: str(q.byName), date: FC.toIsoDate(q.at), notes: str(q.notes),
        failed: arr(q.items).filter((i) => str(i && i.state) === 'fail').map((i) => str(i.label)).filter(Boolean) };
    });
  }
  function qcOverall(c) {
    const l = workOrderQc(c);
    if (!l.length) return '';
    return l.some((x) => x.result === 'failed') ? 'failed' : l.every((x) => x.result === 'passed') ? 'passed' : '';
  }
  const lastQcBy = (c) => { const l = workOrderQc(c).filter((x) => x.byName); return l.length ? l[l.length - 1].byName : ''; };

  FC.register(Object.assign({
    id: 'qc_checklist', title: 'QC CHECKLIST', audience: 'ops', orientation: 'portrait', bodySet: 'js/forms-set-2.js',
    number: { series: 'QC', record: (c) => c.project, derive: (c) => 'QC-' + joInfo(c).number },
    signatures: ['checked', 'approved'],
    date: () => '', extraMeta: jobMeta, guard: jobGuard,
    sign: (c) => [
      { role: 'Checked by', name: lastQcBy(c), lines: ['QC inspector'] },
      { role: FC.LABELS.approvedBy, name: '', lines: ['Production'] },
    ],
    fields: jobFields().concat([
      { key: 'checks', label: 'QC checks', list: true, from: (c) => tickedChecks((joOf(c) || { qcChecks: joRaw(c).qcChecks }).qcChecks, joRaw(c).qcTicks) },
      { key: 'workOrderQc', label: 'Work-order inspections', list: true, from: workOrderQc },
      { key: 'result', label: 'Overall result', from: qcOverall },
      { key: 'notes', label: 'Inspection notes', freeText: true, from: (c) => str(joRaw(c).qcNotes) },
    ]),
  }, jobSource));

  // delivery_receipt: moved onto the engine; content = the old production.js print (printDeliveryReceipt): Deliver To / Work Order, a # / Description /
  // Qty table of the work order's line plus three blank rows, the notes, Delivered by / Received by (client). The record is the PRODUCTION ORDER
  // (work order): pass it as ref.record (Forms loads it into ctx.order); the DR serial is the one recorded on it (deliveryReceipt.no), never assigned here.
  const woOf = (c) => c.workOrder || c.order;
  const drOf = (c) => (woOf(c) && woOf(c).deliveryReceipt) || {};
  FC.register({
    id: 'delivery_receipt', title: 'DELIVERY RECEIPT', audience: 'ops', orientation: 'portrait', bodySet: 'js/forms-set-2.js',
    source: { coll: 'production_orders', via: 'docId' }, records: { project: 'optional' }, needs: [],
    number: { series: 'DR', record: woOf,
      resolve: (c) => (str(drOf(c).no) ? { number: str(drOf(c).no), source: 'stored' } : { number: 'DR-' + FC.last6(woOf(c).id), source: 'fallback' }),
      fallback: (r) => 'DR-' + FC.last6(r && r.id) },
    signatures: ['prepared', 'received'],
    date: (c) => drOf(c).date || '',
    extraMeta: (c) => ['Work Order: ' + str(woOf(c) && woOf(c).orderNo), woOf(c) && str(woOf(c).quoteRef) ? 'Quote: ' + str(woOf(c).quoteRef) : ''],
    guard: (c) => (woOf(c) ? '' : 'We could not find that work order.'),
    sign: (c) => [
      { role: 'Delivered by', name: str(drOf(c).byName), lines: ['Production — Barro Industries'] },
      { role: 'Received by (client)', name: str(drOf(c).receivedBy), lines: [str(woOf(c).client)] },
    ],
    fields: [
      { key: 'client', label: 'Deliver to', from: (c) => first(woOf(c).client, c.project && c.project.clientName) },
      { key: 'orderNo', label: 'Work order', from: (c) => str(woOf(c).orderNo) },
      { key: 'quoteRef', label: 'Quote ref', from: (c) => str(woOf(c).quoteRef) },
      { key: 'itemTitle', label: 'Description', from: (c) => str(woOf(c).title) },
      { key: 'qty', label: 'Qty', from: (c) => fin(woOf(c).qty) },
      { key: 'receivedBy', label: 'Received by (client rep)', from: (c) => str(drOf(c).receivedBy) },
      { key: 'notes', label: 'Notes', freeText: true, from: (c) => str(drOf(c).notes) },
    ],
  });

  FC.register(Object.assign({
    id: 'installation_checklist', title: 'INSTALLATION CHECKLIST', audience: 'ops', orientation: 'portrait', bodySet: 'js/forms-set-2.js',
    number: { series: 'INS', record: (c) => c.project, derive: (c) => 'INS-' + joInfo(c).number },
    signatures: ['prepared', 'checked'],
    date: () => '', extraMeta: jobMeta, guard: jobGuard,
    sign: () => [
      { role: 'Prepared by', name: '', lines: ['Installation lead'] },
      { role: 'Checked by', name: '', lines: ['Production'] },
    ],
    fields: jobFields().concat([
      { key: 'checks', label: 'Installation checks', list: true, from: (c) => tickedChecks((joOf(c) || { installChecks: joRaw(c).installChecks }).installChecks, joRaw(c).installTicks) },
      { key: 'notes', label: 'Installation notes', freeText: true, from: (c) => str(joRaw(c).installNotes) },
    ]),
  }, jobSource));

  const punchOf = (c) => { const p = c.project && c.project.punchList; return Array.isArray(p) ? { items: p } : (p && typeof p === 'object' ? p : {}); };
  FC.register(Object.assign({
    id: 'punch_list', title: 'PUNCH LIST', audience: 'ops', orientation: 'portrait', bodySet: 'js/forms-set-2.js',
    number: { series: 'PL', record: (c) => c.project, derive: (c) => 'PL-' + joInfo(c).number },
    signatures: ['prepared', 'conforme'],
    date: () => '', extraMeta: jobMeta, guard: jobGuard,
    sign: (c, d) => [
      { role: 'Prepared by', name: first(punchOf(c).clearedBy), lines: ['Barro representative'] },
      { role: 'Conforme — Client', name: d.clientName || 'CLIENT NAME', lines: ['Signature over printed name', 'Date: ___________________'] },
    ],
    fields: jobFields().concat([
      { key: 'items', label: 'Punch list items', list: true, from: (c) => arr(punchOf(c).items).map((x) => ({ text: str(x && (x.text || x.note)), location: str(x && x.location),
        raisedDate: FC.toIsoDate(x && x.raisedDate), done: !!(x && x.done), doneDate: FC.toIsoDate(x && x.doneDate), by: str(x && (x.by || x.byName)) })).filter((x) => x.text) },
      { key: 'clearedOn', label: 'Cleared on', from: (c) => FC.toIsoDate(punchOf(c).clearedAt) },
      { key: 'clearedBy', label: 'Cleared by', from: (c) => str(punchOf(c).clearedBy) },
    ]),
  }, jobSource));

  const accOf = (c) => (c.project && c.project.acceptance && typeof c.project.acceptance === 'object' ? c.project.acceptance : {});
  FC.register(Object.assign({}, jobSource, {
    id: 'client_acceptance', title: 'CLIENT ACCEPTANCE FORM', audience: 'ops', orientation: 'portrait', bodySet: 'js/forms-set-2.js', reviewQr: true,
    needs: [PRODUCTION, 'js/qrcode.js'],
    number: { series: 'ACC', record: (c) => c.project, derive: (c) => 'ACC-' + joInfo(c).number },
    signatures: ['prepared', 'conforme'],
    date: (c) => accOf(c).date || '', extraMeta: jobMeta, guard: jobGuard,
    sign: (c, d, co) => [
      { role: 'Prepared by', name: first(accOf(c).byName), lines: ['Barro representative'] },
      { role: 'Conforme — Accepted by Client', name: first(accOf(c).signedBy) || d.clientName || 'CLIENT NAME', lines: ['Signature over printed name', 'Date: ___________________'] },
    ],
    fields: jobFields().concat([
      { key: 'signedBy', label: 'Accepted by', from: (c) => str(accOf(c).signedBy) },
      { key: 'acceptedOn', label: 'Accepted on', from: (c) => FC.toIsoDate(accOf(c).date) },
      { key: 'signedCopy', label: 'Signed copy on file', from: (c) => !!str(accOf(c).url) },
      { key: 'punchOpen', label: 'Punch-list items still open', from: (c) => arr(punchOf(c).items).filter((x) => x && str(x.text || x.note) && !x.done).length },
      { key: 'punchCount', label: 'Punch-list items', from: (c) => arr(punchOf(c).items).filter((x) => x && str(x.text || x.note)).length },
    ]),
  }));

  W().FormsCore = FC;
  if (typeof module !== 'undefined' && module.exports) module.exports = FC;
})();
