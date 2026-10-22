// js/cir-forms.js — CLIENT-INFO-REQUEST-SPEC.md §1.4–1.7 (WS-0).
//
// Canonical, versioned form definition for the "Client Information Request"
// feature (public intake form → Sales › Briefs). Byte-identical mirror lives
// at functions/cir-forms.js (ci-invariants check 7 enforces this — edit THIS
// file, then `cp js/cir-forms.js functions/cir-forms.js`, never the reverse).
//
// Two questionnaires live here, side by side (spec §1.4 "a second
// questionnaire is a new FORMS key — no migration"):
//   - commissary_brief  (v1, 2026-09-26) — the original commissary-only form.
//     RETIRED from the public page on 2026-10-22 but kept VERBATIM: every
//     submission already stored under it still renders with this definition in
//     Sales › Briefs, and a page that was open before the redesign can still
//     submit it. Do not edit it.
//   - project_brief_v2  (2026-10-22) — the general project brief: one common
//     path for every kind of project plus a short conditional part per project
//     type (`when`), see the comment above FORMS.project_brief_v2.
//
// UMD-ish shim so all three consumers load the same bytes with zero deps:
//   - browser <script> (classic, non-module): defines window.CIR_FORMS /
//     window.CIR_PRIVACY_NOTICE / window.CIR_NOTICES / window.CIR_LIMITS
//   - Node CommonJS require() (functions/index.js, functions/cir-core.js,
//     tests/client-info-request.test.mjs): exports { FORMS, PRIVACY_NOTICE, NOTICES, LIMITS }
//
// Zero dependencies. Must not reference any browser global at load time
// other than a guarded `typeof window`.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;   // functions/ + tests
  if (root) { root.CIR_FORMS = api.FORMS; root.CIR_PRIVACY_NOTICE = api.PRIVACY_NOTICE; root.CIR_NOTICES = api.NOTICES; root.CIR_LIMITS = api.LIMITS; }
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  // ── 1.5 LIMITS — single source for page + server ──────────────────────
  var LIMITS = {
    maxPhotos: 20,             // per submission
    maxPhotoBytes: 900000,     // per photo AFTER client downscale (server rejects above)
    minPhotoBytes: 2000,
    maxTotalPhotoBytes: 12000000,
    photoLongEdge: 1600,       // client canvas target
    photoQuality: 0.8,         // client JPEG quality (retry ladder: 0.8 → 0.6 → long edge 1200 @ 0.6)
    maxCaption: 120,
    maxEquipmentRows: 40,
    maxCellChars: 120,
    maxPayloadBytes: 200000,   // JSON.stringify(payload).length cap, checked client AND server
    minFillMs: 15000,          // submit must be ≥ 15 s after the draft was created (server clock)
    draftTtlMs: 7 * 24 * 3600e3,
    dupWindow: 'day'           // duplicate guard = same email+phone fingerprint on the same Manila date
  };

  // ── 1.6 PRIVACY_NOTICE — canonical text; version bump on any wording change ──
  //
  // TWO versions are kept. PRIVACY_NOTICE is the CURRENT one, shown by the
  // project brief (project_brief_v2); it differs from the original where the
  // original named a kitchen (the consent line and the "What we collect" and
  // "Why" sections) and in the privacy contact, which is now the domain
  // address hello@barroindustries.com instead of the Gmail one (2026-10-22,
  // owner). The other five sections — lawful basis, sharing, retention,
  // rights, security — are the original objects themselves (js/qr-def.js's
  // notice and functions/portal-core.js's carry the same controller section
  // and a test pins that, so the three notices change together).
  // PRIVACY_NOTICE_2026_09_26_1 is the ORIGINAL text, kept verbatim — Gmail
  // address included, because it is what the briefs already stored under it
  // were shown: a page that was open before the redesign still sends that
  // version, the server accepts any version listed in NOTICES and records the
  // consent against the text that was actually shown, and Sales › Briefs
  // prints the right consent line for an older brief. Never edit a version
  // once it has been live — add a new one and list it in NOTICES.
  // (2026-10-22.1 itself has not been live: it first ships with the project
  // brief redesign, so it carries the contact change too.)
  var PRIVACY_NOTICE_2026_09_26_1 = {
    version: '2026-09-26.1',
    consentLine: 'I agree to Barro Industries using this information and these photos to prepare my kitchen design and proposal, in line with the Data Privacy Act of 2012 (RA 10173).',
    sections: [
      { heading: 'Who is responsible for your data',
        body: 'Personal Information Controller: Barro Industries OPC (SEC-registered, Metro Manila), trading as Barro Kitchens. Contact for privacy matters: the President, 0927 683 6300, barroindustries@gmail.com.' },
      { heading: 'What we collect on this page',
        body: 'Your name, position, company, mobile number, e-mail, addresses; your answers about your business, kitchen, site, utilities, storage, permits, scope, timeline and budget; the photos you choose to attach and their captions; the date and time you send the form; and your device\'s IP address and browser identifier.' },
      { heading: 'Why',
        body: 'To plan your kitchen layout, equipment, exhaust and utilities; to prepare a design and a proposal; and to contact you to schedule a site visit and follow up on this request.' },
      { heading: 'Lawful basis',
        body: 'Republic Act 10173 section 12(b) — steps taken at your request before entering into a contract — and your consent for the photos and for the communications about this request.' },
      { heading: 'Who we share it with',
        body: 'Barro Industries staff who work on your request; Google LLC, whose Firebase/Google Cloud services host this system (servers may be outside the Philippines); and government authorities only when the law requires it. We do not sell or rent personal data.' },
      { heading: 'How long we keep it',
        body: 'If no project follows, up to twenty-four (24) months from our last contact with you, then deleted. If a project follows, for the life of the project and ten (10) years after turnover, in line with Philippine record-keeping requirements. You may ask us to delete this request and its photos at any time.' },
      { heading: 'Your rights',
        body: 'To be informed; to access; to object; to rectification; to erasure or blocking; to damages; to data portability; and to lodge a complaint with the National Privacy Commission (privacy.gov.ph). Write to the contact above; we respond within fifteen (15) working days.' },
      { heading: 'Security',
        body: 'Data is encrypted in transit; photos and answers are readable only by authorised staff. This page stores a draft of your answers and an upload key only in your own browser — no advertising cookies.' }
    ]
  };
  var PRIVACY_NOTICE = {
    version: '2026-10-22.1',
    consentLine: 'I agree to Barro Industries using this information and these photos to plan and quote my project, in line with the Data Privacy Act of 2012 (RA 10173).',
    sections: [
      { heading: 'Who is responsible for your data',
        body: 'Personal Information Controller: Barro Industries OPC (SEC-registered, Metro Manila), trading as Barro Kitchens. Contact for privacy matters: the President, 0927 683 6300, hello@barroindustries.com.' },
      { heading: 'What we collect on this page',
        body: 'Your name, role, organisation, mobile number, e-mail and project location; your answers about your project, site, utilities, scope, materials, timing, the budget range you choose to share and how the purchase will be made; the photos you choose to attach and their captions; the date and time you send the form; and your device\'s IP address and browser identifier.' },
      { heading: 'Why',
        body: 'To plan your project; to prepare a design and a quotation; and to contact you to arrange a site visit and follow up on this request.' },
      PRIVACY_NOTICE_2026_09_26_1.sections[3],
      PRIVACY_NOTICE_2026_09_26_1.sections[4],
      PRIVACY_NOTICE_2026_09_26_1.sections[5],
      PRIVACY_NOTICE_2026_09_26_1.sections[6],
      PRIVACY_NOTICE_2026_09_26_1.sections[7]
    ]
  };
  // every notice version the server will accept a consent against (own-key lookups only)
  var NOTICES = {};
  NOTICES[PRIVACY_NOTICE_2026_09_26_1.version] = PRIVACY_NOTICE_2026_09_26_1;
  NOTICES[PRIVACY_NOTICE.version] = PRIVACY_NOTICE;

  // ── 1.7 FORMS.commissary_brief — the complete v1 definition ───────────
  // Content baseline = Neil's original /Users/neilbarro/Downloads/commissary-intake.html.
  // Transcribed exactly: option strings are the original value= attributes;
  // {v,l} pairs are used where Neil's chip label differed from its value.
  // Wording, order and placeholders are his, except the two deliberate
  // additions noted in the spec's "Notes for WS-0": the `label`s on the
  // `pain`/`compliance`/`scope`... chips fields (rendered as `.sub` headings
  // — same wording Neil already used as `.sub` text) and the new Photos part.
  var FORMS = {
    commissary_brief: {
      formId: 'commissary_brief',
      formVersion: 1,
      brand: 'BARRO INDUSTRIES · Commercial Kitchen Fabrication',
      title: 'Commissary kitchen project brief',
      intro: "Tell us how your kitchen runs today and where you want it to go. We use this to plan your layout, equipment, exhaust and utilities before our site visit. Anything you're unsure of, leave blank — we'll go through it together.",
      specs: [ { b: '10 parts', t: 'in this form' }, { b: '15–25 min', t: 'to complete' }, { b: 'Auto-saved', t: 'on this device' } ],
      footer: 'Barro Industries · Valenzuela City, Metro Manila',
      submitLabel: 'Send project brief',
      doneTitle: 'Project brief sent',
      doneBody: 'Thank you. Our team will review your answers and contact you to schedule a site visit.',
      sections: [
        { key: 'client', title: 'Client details', hint: "Who we'll be working with on this project.", fields: [
          { key: 'name',         label: 'Full name',                 type: 'text',  required: true, autocomplete: 'name', max: 120 },
          { key: 'position',     label: 'Position / role',           type: 'text',  placeholder: 'e.g. Owner, Operations Manager', max: 80 },
          { key: 'company',      label: 'Company name',              type: 'text',  required: true, w: 'full', autocomplete: 'organization', max: 120 },
          { key: 'phone',        label: 'Mobile number',             type: 'tel',   required: true, placeholder: '09XX XXX XXXX', autocomplete: 'tel' },
          { key: 'email',        label: 'Email',                     type: 'email', required: true, autocomplete: 'email' },
          { key: 'address',      label: 'Office / business address', type: 'textarea', required: true, w: 'full', rows: 2, max: 500 },
          { key: 'site_address', label: 'Commissary site address',   type: 'textarea', required: true, w: 'full', rows: 2, max: 500, placeholder: 'Where the commissary will be built — include landmarks if helpful' },
          { key: 'contact_pref', label: 'Best way to reach you',     type: 'select', w: 'full', options: ['Phone call','Viber','WhatsApp','Email','Messenger'] }
        ]},
        { key: 'business', title: 'Your business', hint: 'What the commissary will produce and who it serves.', fields: [
          { key: 'biz_type', label: 'Type of business', type: 'select', w: 'full', options: ['Restaurant group / multi-branch','Fast food / QSR franchise','Cloud kitchen','Catering / events','Hotel or resort','Hospital','School / university canteen','Corporate / BPO canteen','Bakery / pastry','Food manufacturing / packaged food','Other'] },
          { key: 'branches_now',    label: 'Branches supplied today',        type: 'number', min: 0, max: 10000 },
          { key: 'branches_target', label: 'Branches in 3 years (target)',   type: 'number', min: 0, max: 10000 },
          { key: 'menu',            label: 'Cuisine and main products',      type: 'textarea', w: 'full', placeholder: 'e.g. Filipino rice meals, sauces and marinades, bread and pastries, frozen dumplings' },
          { key: 'process', label: 'What the commissary will do', type: 'chips', options: ['Raw prep / butchery','Marinating','Sauces and soups','Cook-chill','Frying','Rice cooking','Baking','Portioning and packing','Freezing','Ready-to-eat meals'] },
          { key: 'volume_now',    label: 'Current output per day',  type: 'text', placeholder: 'e.g. 800 meals or 300 kg' },
          { key: 'volume_target', label: 'Target output per day',   type: 'text', placeholder: 'e.g. 2,000 meals' },
          { key: 'hours',         label: 'Operating hours',         type: 'text', placeholder: 'e.g. 4 AM – 8 PM' },
          { key: 'shifts',        label: 'Shifts per day',          type: 'select', options: ['1','2','3 (24 hours)'] },
          { key: 'days',          label: 'Days per week',           type: 'number', min: 1, max: 7 },
          { key: 'staff',         label: 'Kitchen staff per shift', type: 'number', min: 0, max: 10000 }
        ]},
        { key: 'operations', title: 'How you operate today', hint: 'Your current setup tells us what to keep, fix, or rethink.', fields: [
          { key: 'current_setup', label: 'Current setup', type: 'select', w: 'full', options: ['Each branch cooks its own food','We have a commissary, need to expand or relocate','We have a commissary, need to renovate it','Renting kitchen space','New business, no kitchen yet'] },
          { key: 'pain', label: "Problems you're running into", type: 'chips', options: ['Not enough space',"Can't keep up with volume",'Too hot / poor exhaust','Smoke or smell complaints',{ v: 'Inconsistent product quality', l: 'Inconsistent quality' },{ v: 'Workflow crossing / bottlenecks', l: 'Workflow bottlenecks' },'Not enough cold storage','High gas or power bills','Equipment breaking down',{ v: 'Failed inspection / permit issues', l: 'Permit / inspection issues' },{ v: 'Drainage or grease problems', l: 'Drainage / grease problems' }] },
          { key: 'works_well',    label: 'What works well that we should keep?', type: 'textarea', w: 'full' },
          { key: 'biggest_issue', label: 'The one thing you most want fixed',    type: 'textarea', w: 'full' }
        ]},
        { key: 'equipment', title: 'Equipment you use now', hint: 'List the main equipment you currently have, and whether you want to reuse it in the new kitchen. Brand and model are helpful but optional.', fields: [
          { key: 'current_equipment', label: 'Current equipment', type: 'table', minRows: 3, maxRows: 40, addLabel: '+ Add equipment', columns: [
            { key: 'item',  label: 'Equipment',     type: 'text',   placeholder: 'e.g. 3-burner range', width: '28%' },
            { key: 'qty',   label: 'Qty',           type: 'number', min: 0, max: 999, width: '9%' },
            { key: 'brand', label: 'Brand / model', type: 'text',   width: '20%' },
            { key: 'power', label: 'Power',         type: 'select', options: ['LPG','Electric','Steam','None'], width: '14%' },
            { key: 'cond',  label: 'Condition',     type: 'select', options: ['Good','Fair','Poor'], width: '13%' },
            { key: 'plan',  label: 'Plan',          type: 'select', options: ['Reuse','Replace','Unsure'], width: '14%' }
          ]},
          { key: 'needed_equipment', label: 'Equipment you plan to add or need', type: 'chips', options: ['Gas ranges / burners',{ v: 'High-pressure burners / wok ranges', l: 'High-pressure / wok ranges' },'Tilting braising pan','Steam kettles / stock pots','Deep fryers','Combi ovens','Deck / convection ovens',{ v: 'Industrial rice cookers / steamers', l: 'Rice cookers / steamers' },'Blast chiller / freezer','Walk-in chiller','Walk-in freezer','Prep tables and sinks',{ v: 'Meat grinder / slicer / mixer', l: 'Grinder / slicer / mixer' },{ v: 'Vacuum sealer / packaging', l: 'Vacuum sealer / packing' },'Dishwasher / pot wash','Shelving and racks'] }
        ]},
        { key: 'site', title: 'The site', hint: 'The space shapes everything — layout, exhaust routing and utility runs.', fields: [
          { key: 'site_status', label: 'Site condition', type: 'select', w: 'full', options: ['Bare shell / empty space','Existing kitchen, to be renovated','Building under construction','Still looking for a site'] },
          { key: 'ownership',   label: 'Owned or leased?',          type: 'select', options: ['Owned','Leased','Not decided'] },
          { key: 'floor',       label: 'Floor level',               type: 'text', placeholder: 'e.g. Ground floor' },
          { key: 'area',        label: 'Kitchen floor area (sqm)',  type: 'number', min: 0, max: 100000 },
          { key: 'ceiling',     label: 'Ceiling height (m)',        type: 'number', min: 0, max: 50, step: 0.1 },
          { key: 'plans_link',  label: 'Link to floor plan, photos or videos of the site', type: 'url', w: 'full', placeholder: 'Google Drive, Dropbox or similar link' },
          { key: 'site_features', label: 'What the site already has', type: 'chips', options: ['Truck / delivery access','Loading bay','Roof access for exhaust','Can exhaust through side wall','Floor drains','Grease trap','Existing exhaust hood','Epoxy / tiled floor','Staff changing area','Neighbors close by'] },
          { key: 'building_rules', label: 'Building or landlord restrictions', type: 'textarea', w: 'full', placeholder: 'e.g. no roof penetration, work hours only 8–5, no LPG tanks inside' }
        ]},
        { key: 'photos', title: 'Photos', hint: "Photos save us a visit's worth of questions. Take them with your phone — we shrink them before they upload. Up to 20 photos.", fields: [
          { key: 'photos', type: 'photos', groups: [
            { key: 'site',      label: 'Site / space',            hint: 'The room as it is today — walls, floor, ceiling, doors, windows' },
            { key: 'kitchen',   label: 'Existing kitchen',        hint: 'Your current cooking line, hoods, sinks, storage' },
            { key: 'equipment', label: 'Equipment',               hint: 'Overall shots and nameplates of equipment you want to reuse' },
            { key: 'docs',      label: 'Floor plan or documents', hint: 'A photo or screenshot of the plan, lease rules, permits or audit findings' }
          ]}
        ]},
        { key: 'utilities', title: 'Utilities', hint: 'Gas, power and water decide what equipment can run where. "Not sure" is fine.', fields: [
          { key: 'gas',         label: 'Gas supply',                 type: 'select', options: ['LPG cylinders (50 kg)','LPG bulk tank / manifold','Existing gas pipeline','None yet','Not sure'] },
          { key: 'gas_monthly', label: 'Current LPG use per month',  type: 'text', placeholder: 'e.g. 12 × 50 kg tanks' },
          { key: 'power',       label: 'Electrical supply',          type: 'select', options: ['Single-phase 220V','Three-phase','Not sure'] },
          { key: 'power_cap',   label: 'Available load (kVA / amps)',type: 'text', placeholder: 'If known' },
          { key: 'genset',      label: 'Backup generator',           type: 'select', options: ['Yes, covers whole kitchen','Yes, partial','No','Planning to add'] },
          { key: 'water',       label: 'Water supply',               type: 'select', options: ['Maynilad / Manila Water','Local water district','Deep well','Mixed / with storage tank','Not sure'] },
          { key: 'hot_water',   label: 'Hot water',                  type: 'select', w: 'full', options: ['Have a heater system','Need hot water','Not needed'] }
        ]},
        { key: 'logistics', title: 'Storage, receiving and dispatch', hint: "How food comes in, where it's kept, and how it leaves for your branches.", fields: [
          { key: 'deliveries',  label: 'Supplier deliveries',   type: 'select', options: ['Daily','2–3 times a week','Weekly','We buy from market ourselves'] },
          { key: 'dispatch',    label: 'Dispatch to branches',  type: 'select', options: ['Once a day','Twice a day','Every other day','Weekly'] },
          { key: 'chiller_cap', label: 'Chilled storage needed',type: 'text', placeholder: 'e.g. 2 tons or 20 racks' },
          { key: 'freezer_cap', label: 'Frozen storage needed', type: 'text', placeholder: 'e.g. 3 tons' },
          { key: 'dry_storage', label: 'Dry storage and packaging materials', type: 'text', w: 'full', placeholder: 'e.g. 50 sacks of rice, boxes, containers' },
          { key: 'transport',   label: 'How food is transported', type: 'text', w: 'full', placeholder: 'e.g. 2 reefer vans, insulated boxes on L300' }
        ]},
        { key: 'compliance', title: 'Permits and standards', hint: 'So the layout meets what inspectors and certifiers will check.', fields: [
          { key: 'compliance', label: 'Permits and standards you need to meet', type: 'chips', options: ['Sanitary permit',{ v: 'FDA LTO (food manufacturer)', l: 'FDA LTO' },{ v: 'BFP fire safety (FSIC)', l: 'BFP fire safety' },'HACCP','ISO 22000 / FSSC','Halal','DENR / LLDA wastewater',{ v: 'Mall / building admin standards', l: 'Mall / building standards' },'Not sure yet'] },
          { key: 'compliance_notes', label: 'Any audit findings or requirements we should know about?', type: 'textarea', w: 'full' }
        ]},
        { key: 'scope', title: 'Scope, timeline and budget', hint: "What you'd like Barro Industries to handle.", fields: [
          { key: 'scope', label: 'Scope of work', type: 'chips', options: [{ v: 'Kitchen layout and design', l: 'Layout and design' },{ v: 'Stainless steel fabrication', l: 'Stainless fabrication' },{ v: 'Cooking equipment supply', l: 'Cooking equipment' },'Exhaust hood and ducting',{ v: 'Fresh air / make-up air', l: 'Fresh air system' },{ v: 'LPG pipeline and manifold', l: 'LPG pipeline' },{ v: 'Cold room / walk-in', l: 'Cold rooms' },{ v: 'Installation and commissioning', l: 'Installation' },{ v: 'Preventive maintenance', l: 'Maintenance' }] },
          { key: 'target_date', label: 'Target opening date',     type: 'date' },
          { key: 'budget',      label: 'Budget range',            type: 'select', options: ['Below ₱1M','₱1M – ₱3M','₱3M – ₱5M','₱5M – ₱10M','Above ₱10M','Need guidance'] },
          { key: 'decision',    label: 'Who approves the project?', type: 'text', placeholder: 'Name and role' },
          { key: 'site_visit',  label: 'Preferred site visit schedule', type: 'text', placeholder: 'e.g. weekday mornings' },
          { key: 'notes',       label: 'Anything else we should know?', type: 'textarea', w: 'full' }
        ]}
      ],
      // keys the server copies into `summary` (must all be real field keys of this form)
      summaryKeys: { name: 'name', company: 'company', phone: 'phone', email: 'email', siteAddress: 'site_address', bizType: 'biz_type', budget: 'budget', targetDate: 'target_date' }
    }
  };

  // ══════════════════════════════════════════════════════════════════════
  //  FORMS.project_brief_v2 — the general project brief (2026-10-22)
  //
  //  Owner brief: the commissary form was "too specific to commissary"; there
  //  are many kinds of project — restaurant, café, commissary, hospital,
  //  school and so on. So this questionnaire is ONE common path plus a short
  //  conditional part per project type:
  //    · Step 1 asks the project type (`project_type`, required).
  //    · A section carrying `when: { key: 'project_type', in: [...] }` belongs
  //      to those types ONLY. The page shows it only for a matching type;
  //      cir-core's validateAnswers() ACCEPTS its answers only when the
  //      submitted type matches (a mismatched answer is rejected, never
  //      silently dropped), and requires its `required` fields only then;
  //      Sales › Briefs renders only the sections that apply to the brief.
  //    · `requireOneOf` is a form-level rule: at least one of the listed
  //      fields must be answered ("a mobile number or an email address").
  //    · Required, everywhere else: type, name, one of mobile / email, city,
  //      province and at least one scope item — plus a description when the
  //      type is "Other". Everything else is optional, the approximate budget
  //      band included (see the comment on the `budget` question below).
  //  `select` fields may carry `ui: 'cards'` (the type picker) or
  //  `ui: 'choice'` (radio pills); both are ordinary selects to the validator.
  //  An option's optional `d` is a one-line description shown on a card.
  //  Stored option VALUES are stable keys (snake_case); the labels may be
  //  reworded later without touching old submissions.
  //  Photo group keys (site / kitchen / equipment / docs) are the same as v1.
  // ══════════════════════════════════════════════════════════════════════
  var PROJECT_TYPES = [
    { v: 'restaurant', l: 'Restaurant',                   d: 'Dine-in, fast food or grill' },
    { v: 'cafe',       l: 'Café',                         d: 'Coffee shop or snack bar' },
    { v: 'bakery',     l: 'Bakery',                       d: 'Bread, cakes and pastries' },
    { v: 'commissary', l: 'Commissary / central kitchen', d: 'Production for several outlets' },
    { v: 'hotel',      l: 'Hotel or resort',              d: 'Kitchens, outlets and banquets' },
    { v: 'catering',   l: 'Catering',                     d: 'Events and meal services' },
    { v: 'hospital',   l: 'Hospital or clinic',           d: 'Patient and staff meals' },
    { v: 'school',     l: 'School or university',         d: 'Canteen or laboratory' },
    { v: 'laboratory', l: 'Laboratory',                   d: 'Testing, research or teaching' },
    { v: 'government', l: 'Government office or LGU',     d: 'Canteen, feeding programme or office' },
    { v: 'home',       l: 'Home or residential',          d: 'Outdoor, dirty or full kitchen' },
    { v: 'other',      l: 'Other (specify)',              d: 'Something else; tell us about it' }
  ];
  var LAB_TYPES = [
    { v: 'chemistry', l: 'Chemistry' },
    { v: 'biology',   l: 'Biology or microbiology' },
    { v: 'physics',   l: 'Physics or general science' },
    { v: 'food',      l: 'Food science or food technology' },
    { v: 'medical',   l: 'Medical or clinical' },
    { v: 'research',  l: 'Research or analytical' },
    { v: 'other',     l: 'Other' }
  ];
  var LAB_SERVICES = [
    { v: 'sinks',   l: 'Sinks at the stations' },
    { v: 'gas',     l: 'Gas points' },
    { v: 'exhaust', l: 'Exhaust for fumes' }
  ];

  FORMS.project_brief_v2 = {
    formId: 'project_brief_v2',
    formVersion: 1,
    eyebrow: 'Project brief',
    title: 'Tell us about your project',
    intro: 'Share the details of your kitchen, laboratory or fabrication project. We use your answers to plan your layout, equipment and utilities before our site visit. Anything you are unsure of, leave blank; we will go through it together.',
    specs: [ { b: '5–10 minutes', t: 'to complete' }, { b: 'Only what fits', t: 'your type of project' }, { b: 'Auto-saved', t: 'on this device' } ],
    submitLabel: 'Send project brief',
    doneTitle: 'Project brief sent',
    doneBody: 'Thank you. Our team will review your answers and contact you to arrange a site visit.',
    sections: [
      // ── Common: every project ─────────────────────────────────────────
      { key: 'type', short: 'Project type', title: 'What type of project is this?', hint: 'Choose the closest match. We use it to ask only the questions that fit your project.', fields: [
        { key: 'project_type', label: 'Project type', type: 'select', ui: 'cards', required: true, options: PROJECT_TYPES }
      ]},
      { key: 'contact', short: 'About you', title: 'About you', hint: 'So we know who to talk to. Give us a mobile number or an email address, or both.', fields: [
        { key: 'name',     label: 'Full name',               type: 'text',  required: true, autocomplete: 'name', max: 120 },
        { key: 'position', label: 'Your role',               type: 'text',  placeholder: 'e.g. Owner, Operations Manager', autocomplete: 'organization-title', max: 80 },
        { key: 'company',  label: 'Organisation or company', type: 'text',  w: 'full', hint: 'Leave this blank for a personal or home project.', autocomplete: 'organization', max: 120 },
        { key: 'phone',    label: 'Mobile number',           type: 'tel',   placeholder: '09XX XXX XXXX', autocomplete: 'tel' },
        { key: 'email',    label: 'Email',                   type: 'email', autocomplete: 'email' }
      ]},
      { key: 'location', short: 'Location', title: 'Where is the project?', hint: 'Tell us where it will be, so we can plan a site visit.', fields: [
        { key: 'city',         label: 'City or municipality',         type: 'text', required: true, autocomplete: 'address-level2', max: 80 },
        { key: 'province',     label: 'Province or region',           type: 'text', required: true, placeholder: 'e.g. Metro Manila', autocomplete: 'address-level1', max: 80 },
        { key: 'site_address', label: 'Street, barangay or landmark', type: 'textarea', w: 'full', rows: 2, max: 300, hint: 'Optional. It helps us plan the site visit.' },
        { key: 'site_status',  label: 'Is the project a new build, a renovation or an equipment replacement?', type: 'select', ui: 'choice', w: 'full', options: [
          { v: 'new_build',   l: 'New build' },
          { v: 'renovation',  l: 'Renovation' },
          { v: 'replacement', l: 'Replacing equipment' }
        ]}
      ]},

      // ── Conditional: one short part per type of project ───────────────
      { key: 'food', short: 'Menu and service', title: 'Your menu and service', hint: 'A rough idea is enough. Skip anything you are unsure of.',
        when: { key: 'project_type', in: ['restaurant', 'cafe', 'bakery', 'catering'] }, fields: [
        { key: 'cuisine',       label: 'Cuisine or menu style', type: 'text', w: 'full', placeholder: 'e.g. Filipino, grill, coffee and pastries, bread and cakes', max: 120 },
        { key: 'seats',         label: 'Seats or covers',       type: 'number', min: 0, max: 100000, hint: 'Guests served at one time. For catering, the usual number of guests per event.' },
        { key: 'meals_per_day', label: 'Meals or orders per day', type: 'number', min: 0, max: 1000000, hint: 'A rough daily average is fine.' },
        { key: 'service_style', label: 'Service style', type: 'chips', options: [
          { v: 'dine_in',  l: 'Dine-in' },
          { v: 'takeaway', l: 'Takeaway' },
          { v: 'delivery', l: 'Delivery' },
          { v: 'buffet',   l: 'Buffet or banquet' },
          { v: 'events',   l: 'Events or off-site catering' }
        ]},
        { key: 'cooking_methods', label: 'Main cooking methods', type: 'chips', options: [
          { v: 'grill_fry',  l: 'Grilling or frying' },
          { v: 'baking',     l: 'Baking' },
          { v: 'wok',        l: 'Wok or high-heat cooking' },
          { v: 'boil_steam', l: 'Boiling or steaming' },
          { v: 'cold_prep',  l: 'Cold preparation or pastry' },
          { v: 'beverages',  l: 'Coffee or beverages' }
        ]}
      ]},
      { key: 'commissary', short: 'Commissary', title: 'Your commissary', hint: 'What you produce and how many outlets you supply.',
        when: { key: 'project_type', in: ['commissary'] }, fields: [
        { key: 'outlets_now',    label: 'Outlets you supply',            type: 'number', min: 0, max: 10000, hint: 'Today, or when you open.' },
        { key: 'outlets_target', label: 'Outlets planned in three years', type: 'number', min: 0, max: 10000 },
        { key: 'volume_day',     label: 'Production volume per day',     type: 'text', w: 'full', placeholder: 'e.g. 800 meals or 300 kg', hint: 'Today, and your target if you know it.', max: 120 },
        { key: 'menu_categories', label: 'Menu categories', type: 'chips', options: [
          { v: 'rice_meals',  l: 'Rice meals and viands' },
          { v: 'meat',        l: 'Meat, poultry or seafood' },
          { v: 'sauces',      l: 'Sauces, soups and marinades' },
          { v: 'bakery',      l: 'Bread, cakes and pastries' },
          { v: 'produce',     l: 'Fruit and vegetables' },
          { v: 'frozen',      l: 'Frozen or chilled products' },
          { v: 'ready_meals', l: 'Ready-to-eat meals' }
        ]},
        { key: 'process', label: 'What the commissary will do', type: 'chips', options: [
          { v: 'prep',       l: 'Raw preparation or butchery' },
          { v: 'marinating', l: 'Marinating' },
          { v: 'sauces',     l: 'Sauces and soups' },
          { v: 'cook_chill', l: 'Cook-chill' },
          { v: 'frying',     l: 'Frying' },
          { v: 'rice',       l: 'Rice cooking' },
          { v: 'baking',     l: 'Baking' },
          { v: 'packing',    l: 'Portioning and packing' },
          { v: 'freezing',   l: 'Freezing' }
        ]}
      ]},
      { key: 'hotel', short: 'Hotel or resort', title: 'Your hotel or resort', hint: 'The kitchens, rooms and events we need to plan for.',
        when: { key: 'project_type', in: ['hotel'] }, fields: [
        { key: 'hotel_kitchens',  label: 'Kitchens or food outlets',      type: 'number', min: 0, max: 1000, hint: 'Main kitchen, restaurants, bars and staff canteen. Count each one.' },
        { key: 'hotel_rooms',     label: 'Number of rooms',               type: 'number', min: 0, max: 10000 },
        { key: 'banquet_capacity', label: 'Banquet or function capacity', type: 'number', min: 0, max: 100000, hint: 'Guests at your largest event, if you have one.' },
        { key: 'hotel_services', label: 'Food services you offer', type: 'chips', options: [
          { v: 'breakfast',    l: 'Breakfast' },
          { v: 'restaurant',   l: 'Restaurant dining' },
          { v: 'room_service', l: 'Room service' },
          { v: 'banquets',     l: 'Banquets and events' },
          { v: 'staff_meals',  l: 'Staff meals' }
        ]}
      ]},
      { key: 'hospital', short: 'Hospital or clinic', title: 'Your hospital or clinic', hint: 'Meals, special diets and the hygiene rules we need to plan around.',
        when: { key: 'project_type', in: ['hospital'] }, fields: [
        { key: 'hosp_meals',    label: 'Meals prepared per day', type: 'number', min: 0, max: 1000000 },
        { key: 'hosp_patients', label: 'Patients served',        type: 'number', min: 0, max: 100000, hint: 'Beds, or the usual number of patients per day.' },
        { key: 'hosp_staff',    label: 'Staff served',           type: 'number', min: 0, max: 100000, hint: 'Staff who eat from your kitchen each day.' },
        { key: 'hosp_diets', label: 'Special diets and tray service', type: 'chips', options: [
          { v: 'diabetic',  l: 'Diabetic or low-sugar meals' },
          { v: 'low_salt',  l: 'Low-salt or renal meals' },
          { v: 'soft',      l: 'Soft or pureed meals' },
          { v: 'infant',    l: 'Infant formula or milk preparation' },
          { v: 'tray_line', l: 'Tray line for patient meals' },
          { v: 'allergen',  l: 'Allergen-controlled preparation' }
        ]},
        { key: 'hosp_infection', label: 'Infection-control requirements', hint: 'Tick any rules your hospital, clinic or licensing body already requires.', type: 'chips', options: [
          { v: 'separate_areas', l: 'Separate clean and dirty areas' },
          { v: 'hands_free',     l: 'Hands-free or foot-operated taps' },
          { v: 'seamless',       l: 'Seamless, easy-to-sanitise surfaces' },
          { v: 'hot_dishwash',   l: 'Hot-water dishwashing' },
          { v: 'licensing',      l: 'Hospital or DOH licensing standards' },
          { v: 'not_sure',       l: 'Not sure yet' }
        ]}
      ]},
      { key: 'school', short: 'School or university', title: 'Your school or university', hint: 'Tell us about the canteen, the laboratory, or both, and skip what does not apply. Laboratories usually call for SS316 laboratory-grade stainless steel. You can choose it in the material step, or we will advise.',
        when: { key: 'project_type', in: ['school'] }, fields: [
        { key: 'school_for', label: 'What do you need?', type: 'chips', options: [
          { v: 'kitchen',    l: 'Canteen or kitchen' },
          { v: 'laboratory', l: 'Laboratory' }
        ]},
        { key: 'school_meals',    label: 'Canteen meals per day', type: 'number', min: 0, max: 1000000, hint: 'Skip this if you only need a laboratory.' },
        { key: 'school_lab_type', label: 'Laboratory type',       type: 'select', options: LAB_TYPES, hint: 'Skip this if you only need a kitchen.' },
        { key: 'school_stations', label: 'Laboratory stations',   type: 'number', min: 0, max: 10000, hint: 'Benches or workstations.' },
        { key: 'school_lab_services', label: 'Laboratory sinks, gas and exhaust', type: 'chips', options: LAB_SERVICES }
      ]},
      { key: 'laboratory', short: 'Laboratory', title: 'Your laboratory', hint: 'Laboratories usually call for SS316 laboratory-grade stainless steel. Tell us how the laboratory is used, and we will advise on the right grade.',
        when: { key: 'project_type', in: ['laboratory'] }, fields: [
        { key: 'lab_type',      label: 'Laboratory type',            type: 'select', options: LAB_TYPES },
        { key: 'lab_stations',  label: 'Workstations or benches',    type: 'number', min: 0, max: 10000 },
        { key: 'lab_chemicals', label: 'Will surfaces be exposed to chemicals?', type: 'select', ui: 'choice', w: 'full', hint: 'This helps us recommend the right grade of stainless steel.', options: [
          { v: 'yes',      l: 'Yes' },
          { v: 'no',       l: 'No' },
          { v: 'not_sure', l: 'Not sure' }
        ]},
        { key: 'lab_services', label: 'Sinks, gas and exhaust', type: 'chips', options: LAB_SERVICES }
      ]},
      { key: 'government', short: 'Government project', title: 'Your government project', hint: 'Government purchases follow procurement rules. Tell us what you can, and we will go through the rest with you.',
        when: { key: 'project_type', in: ['government'] }, fields: [
        { key: 'gov_purpose', label: 'What is the project for?', type: 'select', w: 'full', options: [
          { v: 'canteen', l: 'Canteen or staff kitchen' },
          { v: 'feeding', l: 'Feeding programme' },
          { v: 'other',   l: 'Something else' }
        ]},
        { key: 'gov_served', label: 'People served per day', type: 'number', min: 0, max: 1000000, hint: 'For a canteen or feeding programme.' },
        { key: 'gov_mode',   label: 'Procurement mode',      type: 'select', options: [
          { v: 'public_bidding', l: 'Public bidding' },
          { v: 'svp',            l: 'Small value procurement' },
          { v: 'negotiated',     l: 'Negotiated procurement or direct contracting' },
          { v: 'not_sure',       l: 'Not sure yet' }
        ]},
        { key: 'gov_ref', label: 'Bid or reference number', type: 'text', w: 'full', hint: 'If you have one.', max: 80 }
      ]},
      { key: 'home', short: 'Home kitchen', title: 'Your home kitchen', hint: 'Tell us the kind of kitchen you have in mind.',
        when: { key: 'project_type', in: ['home'] }, fields: [
        { key: 'home_kitchen', label: 'Kitchen type', type: 'select', ui: 'choice', w: 'full', options: [
          { v: 'outdoor',  l: 'Outdoor kitchen' },
          { v: 'dirty',    l: 'Dirty kitchen' },
          { v: 'full',     l: 'Full indoor kitchen' },
          { v: 'not_sure', l: 'Not sure yet' }
        ]},
        { key: 'home_building', label: 'Type of home', type: 'select', ui: 'choice', w: 'full', hint: 'This helps us plan access, gas and exhaust.', options: [
          { v: 'house',     l: 'House' },
          { v: 'townhouse', l: 'Townhouse' },
          { v: 'condo',     l: 'Condominium or apartment' },
          { v: 'other',     l: 'Something else' }
        ]},
        { key: 'home_items', label: 'What would you like?', type: 'chips', options: [
          { v: 'sink',      l: 'Sink' },
          { v: 'worktable', l: 'Work table or countertop' },
          { v: 'stove',     l: 'Stove or gas range' },
          { v: 'hood',      l: 'Range hood and exhaust' },
          { v: 'cabinets',  l: 'Cabinets' },
          { v: 'shelving',  l: 'Shelving' },
          { v: 'not_sure',  l: 'Not sure yet' }
        ]}
      ]},
      { key: 'other', short: 'Your project', title: 'Your project', hint: 'Tell us in your own words what you would like to do.',
        when: { key: 'project_type', in: ['other'] }, fields: [
        { key: 'other_description', label: 'Describe your project', type: 'textarea', required: true, w: 'full', rows: 4, max: 1000, hint: 'What are you building or changing, and what do you need from us?' }
      ]},

      // ── Common: every project, continued ──────────────────────────────
      { key: 'scope', short: 'What you need', title: 'What do you need?', hint: 'Tick everything that applies. Choose at least one.', fields: [
        { key: 'scope', label: 'Scope of work', type: 'chips', required: true, options: [
          { v: 'full_kitchen', l: 'Full kitchen design and build' },
          { v: 'equipment',    l: 'Individual equipment' },
          { v: 'fabrication',  l: 'Custom fabrication' },
          { v: 'exhaust',      l: 'Exhaust and fresh air' },
          { v: 'lpg',          l: 'LPG gas line' },
          { v: 'fire',         l: 'Fire suppression' },
          { v: 'repair',       l: 'Repair or maintenance' }
        ]}
      ]},
      { key: 'space', short: 'Space and utilities', title: 'Space and utilities', hint: 'Approximate answers are fine. "Not sure yet" is a good answer too.', fields: [
        { key: 'area_sqm',   label: 'Approximate floor area (square metres)', type: 'number', min: 0, max: 100000, step: 0.1 },
        { key: 'dimensions', label: 'Dimensions, if you know them',           type: 'text', placeholder: 'e.g. 6 m × 8 m, ceiling 3 m', max: 120 },
        { key: 'floor_plan', label: 'Do you have a floor plan?', type: 'select', ui: 'choice', w: 'full', hint: 'You can attach it as a photo in the Photos step.', options: [
          { v: 'yes', l: 'Yes, I have one' },
          { v: 'no',  l: 'No, not yet' }
        ]},
        { key: 'utilities', label: 'What is available at the site?', type: 'chips', hint: 'Tick what is already there. If you are not sure, tick "Not sure yet".', options: [
          { v: 'lpg',         l: 'LPG' },
          { v: 'natural_gas', l: 'Natural gas' },
          { v: 'electricity', l: 'Electricity' },
          { v: 'water',       l: 'Water supply' },
          { v: 'drainage',    l: 'Drainage' },
          { v: 'exhaust',     l: 'Existing exhaust' },
          { v: 'not_sure',    l: 'Not sure yet' }
        ]}
      ]},
      { key: 'material', short: 'Material and timing', title: 'Material, timing and buying', hint: 'Choose what fits. We will confirm everything at the site visit.', fields: [
        { key: 'material', label: 'Preferred material', type: 'select', ui: 'choice', w: 'full', hint: 'SS304 is our standard food-grade stainless steel. SS316 is laboratory grade.', options: [
          { v: 'ss304',    l: 'SS304 food grade (our standard)' },
          { v: 'ss316',    l: 'SS316 laboratory grade' },
          { v: 'not_sure', l: 'Not sure yet' }
        ]},
        { key: 'finish', label: 'Preferred finish', type: 'select', ui: 'choice', w: 'full', options: [
          { v: 'brushed',  l: 'Brushed' },
          { v: 'mirror',   l: 'Mirror' },
          { v: 'satin',    l: 'Satin' },
          { v: 'not_sure', l: 'Not sure yet' }
        ]},
        { key: 'timeline', label: 'When do you need it?', type: 'select', options: [
          { v: 'asap',           l: 'As soon as possible' },
          { v: 'within_3',       l: 'Within 3 months' },
          { v: 'months_3_6',     l: '3 to 6 months' },
          { v: 'months_6_12',    l: '6 to 12 months' },
          { v: 'over_12',        l: 'More than 12 months' },
          { v: 'not_sure',       l: 'Not sure yet' }
        ]},
        { key: 'target_date', label: 'Target date, if you have one', type: 'date', hint: 'A rough date is fine, such as your opening or turnover date.' },
        // The ONE price-like text on the public brief: peso BANDS the CLIENT picks to tell us what they expect to spend — client-stated
        // budget bands, not prices (Barro quotes nothing here). Optional. Every other price word or peso amount stays banned on this page:
        // scripts/check-brief-copy.js (ci-invariants CHECK 9 + tests/cir-project-brief.test.mjs) lets exactly these strings through, and
        // this question must equal scripts/brief-budget-bands.json field for field. To change a band, edit BOTH, then
        // `cp js/cir-forms.js functions/cir-forms.js`. Stored values are the stable keys; the label is what the summary and Sales read.
        { key: 'budget', label: 'Approximate budget (optional)', type: 'select', ui: 'choice', w: 'full', hint: 'A rough range helps us suggest a scope that fits. Skip it if you prefer.', options: [
          { v: 'under_500k', l: 'Under ₱500,000' },
          { v: '500k_to_1m', l: '₱500,000 – ₱1,000,000' },
          { v: '1m_to_3m',   l: '₱1,000,000 – ₱3,000,000' },
          { v: '3m_to_10m',  l: '₱3,000,000 – ₱10,000,000' },
          { v: 'over_10m',   l: 'Over ₱10,000,000' },
          { v: 'not_sure',   l: 'Prefer not to say / not sure' }
        ]},
        { key: 'buyer_type', label: 'Who is buying?', type: 'select', ui: 'choice', w: 'full',
          hint: 'Government purchases follow procurement rules. If this is one, mention the procurement mode and any bid or reference number in your notes at the end.', options: [
          { v: 'private',    l: 'Private buyer' },
          { v: 'government', l: 'Government agency, LGU or state institution' }
        ]}
      ]},
      { key: 'photos', short: 'Photos', title: 'Photos', hint: "Photos are optional, but they save us a visit's worth of questions. Take them with your phone; we shrink them before they upload. Up to 20 photos.", fields: [
        { key: 'photos', type: 'photos', groups: [
          { key: 'site',      label: 'Site / space',                    hint: 'The room as it is today: walls, floor, ceiling, doors, windows' },
          { key: 'kitchen',   label: 'Existing kitchen or laboratory',  hint: 'Your current cooking line, hoods, sinks, storage or laboratory benches' },
          { key: 'equipment', label: 'Equipment',                       hint: 'Overall shots and nameplates of equipment you want to reuse' },
          { key: 'docs',      label: 'Floor plan or documents',         hint: 'A photo or screenshot of the plan, permits or project documents' }
        ]}
      ]},
      { key: 'final', short: 'Notes and send', title: 'Anything else we should know?', hint: 'Access to the site, deadlines, special requirements, or questions for us.', fields: [
        { key: 'notes', label: 'Notes', type: 'textarea', w: 'full', rows: 4 }
      ]}
    ],
    // At least one of these fields must be answered (cir-core validateAnswers + the page).
    requireOneOf: [
      { keys: ['phone', 'email'], message: 'Please give a mobile number or an email address so we can reach you.' }
    ],
    // How the server builds `summary` (the list view, the notification). A plain string is one field key (a select's
    // OPTION LABEL is stored, not its value); { join: [keys] } joins the non-blank values with ", "; { first: [keys] }
    // takes the first non-blank one. Every key named here must be a real field key of this form.
    summaryKeys: {
      name: 'name', company: 'company', phone: 'phone', email: 'email',
      bizType: 'project_type',
      siteAddress: 'site_address',
      location: { join: ['city', 'province'] },
      targetDate: { first: ['target_date', 'timeline'] },
      budget: 'budget'                                  // the client-stated band's LABEL (never in the push: the push names the location)
    }
  };

  return { FORMS: FORMS, PRIVACY_NOTICE: PRIVACY_NOTICE, NOTICES: NOTICES, LIMITS: LIMITS };
});
