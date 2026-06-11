// ════════════════════════════════════════════════════════
//  BARRO INDUSTRIES — One-Time ClickUp Task Import
//  Paste this entire script in the browser console while
//  logged into the app. Run once only.
// ════════════════════════════════════════════════════════

(async () => {
  const tasks = [
    // ── FINANCE ──────────────────────────────────────
    { title:'General Ledger',         dept:'Finance', status:'open',   priority:'medium', assignees:['Shai Ra'],                                    emails:['tecagshaira1@gmail.com'],                              due:'' },
    { title:'Standardize Documents',  dept:'Finance', status:'open',   priority:'medium', assignees:['Shai Ra'],                                    emails:['tecagshaira1@gmail.com'],                              due:'' },
    { title:'NBS BIR Settlement',     dept:'Finance', status:'open',   priority:'medium', assignees:['Shai Ra','Neil Barro'],                       emails:['tecagshaira1@gmail.com','neilbarro870@gmail.com'],     due:'' },
    { title:'NBS Renewal City Hall',  dept:'Finance', status:'open',   priority:'medium', assignees:['Neil Barro','Shai Ra'],                       emails:['neilbarro870@gmail.com','tecagshaira1@gmail.com'],     due:'' },
    { title:'NBE BIR Settlement',     dept:'Finance', status:'open',   priority:'medium', assignees:['Shai Ra','Neil Barro'],                       emails:['tecagshaira1@gmail.com','neilbarro870@gmail.com'],     due:'' },
    { title:'NBE Closure Municipal Hall', dept:'Finance', status:'open', priority:'medium', assignees:['Shai Ra','Neil Barro'],                     emails:['tecagshaira1@gmail.com','neilbarro870@gmail.com'],     due:'' },
    { title:'OPC Sec Registration',   dept:'Finance', status:'open',   priority:'medium', assignees:['Shai Ra','Neil Barro'],                       emails:['tecagshaira1@gmail.com','neilbarro870@gmail.com'],     due:'' },
    { title:'Sales Acknowledgement',  dept:'Finance', status:'done',   priority:'medium', assignees:[],                                            emails:[],                                                      due:'' },
    { title:'Request for Quotation',  dept:'Finance', status:'done',   priority:'medium', assignees:['Shai Ra'],                                    emails:['tecagshaira1@gmail.com'],                              due:'' },
    { title:'Sales Order',            dept:'Finance', status:'done',   priority:'medium', assignees:['Shai Ra'],                                    emails:['tecagshaira1@gmail.com'],                              due:'' },
    { title:'Material Request Form',  dept:'Finance', status:'done',   priority:'medium', assignees:['Shai Ra'],                                    emails:['tecagshaira1@gmail.com'],                              due:'' },
    { title:'Price Quotation',        dept:'Finance', status:'done',   priority:'medium', assignees:['Shai Ra'],                                    emails:['tecagshaira1@gmail.com'],                              due:'' },
    { title:'Purchase Request',       dept:'Finance', status:'done',   priority:'medium', assignees:['Shai Ra'],                                    emails:['tecagshaira1@gmail.com'],                              due:'' },
    { title:'Purchase Order',         dept:'Finance', status:'done',   priority:'medium', assignees:['Shai Ra'],                                    emails:['tecagshaira1@gmail.com'],                              due:'' },

    // ── MARKETING ─────────────────────────────────────
    { title:'Model Kitchen',          dept:'Marketing', status:'open',        priority:'medium', assignees:['Brandon Paul Chang','Jia Margaux Lopez'], emails:['brandonpaulchang12@gmail.com','margojilopez@gmail.com'], due:'2026-06-12' },
    { title:'ROC (Restaurant Owners and Chefs)', dept:'Marketing', status:'in progress', priority:'medium', assignees:['Jia Margaux Lopez'],         emails:['margojilopez@gmail.com'],                              due:'' },
    { title:'AEC (Architects, Engineers, Contractors)', dept:'Marketing', status:'in progress', priority:'medium', assignees:['Brandon Paul Chang'], emails:['brandonpaulchang12@gmail.com'],                        due:'' },
    { title:'Kitchen Options Infographic', dept:'Marketing', status:'in progress', priority:'urgent', assignees:['Jia Margaux Lopez'],              emails:['margojilopez@gmail.com'],                              due:'2026-06-02' },
    { title:'Create new profile photo',   dept:'Marketing', status:'in progress', priority:'medium', assignees:['Jia Margaux Lopez'],              emails:['margojilopez@gmail.com'],                              due:'2026-06-03' },
    { title:'Create new cover photo',     dept:'Marketing', status:'open',        priority:'medium', assignees:['Jia Margaux Lopez'],              emails:['margojilopez@gmail.com'],                              due:'2026-06-04' },
    { title:'Submit tasks for review',    dept:'Marketing', status:'open',        priority:'medium', assignees:[],                                 emails:[],                                                      due:'' },

    // ── DESIGN ────────────────────────────────────────
    { title:'Ms Ruby (Manila)',        dept:'Design', status:'open',     priority:'urgent', assignees:['Neil Barro','Brandon Paul Chang'],            emails:['neilbarro870@gmail.com','brandonpaulchang12@gmail.com'], due:'2026-06-05' },
    { title:'Mr Rhy (Laoac Pangasinan)', dept:'Design', status:'open',  priority:'high',   assignees:['Neil Barro','Brandon Paul Chang'],            emails:['neilbarro870@gmail.com','brandonpaulchang12@gmail.com'], due:'2026-06-05' },
    { title:'Ms. Melrog (Sta Cruz)',   dept:'Design', status:'in progress', priority:'low', assignees:['Neil Barro','Brandon Paul Chang','Jia Margaux Lopez'], emails:['neilbarro870@gmail.com','brandonpaulchang12@gmail.com','margojilopez@gmail.com'], due:'' },
    { title:'Mr Gerald (Gerrys Grill)', dept:'Design', status:'on hold', priority:'medium', assignees:['Neil Barro','Brandon Paul Chang','Jia Margaux Lopez'], emails:['neilbarro870@gmail.com','brandonpaulchang12@gmail.com','margojilopez@gmail.com'], due:'2026-06-07' },
    { title:'Mr Gerald (Carmona)',     dept:'Design', status:'on hold',  priority:'high',   assignees:['Neil Barro','Brandon Paul Chang'],            emails:['neilbarro870@gmail.com','brandonpaulchang12@gmail.com'], due:'2026-06-05' },
  ];

  // Look up Firestore UIDs by email
  const usersSnap = await db.collection('users').get();
  const emailToUid = {};
  usersSnap.docs.forEach(d => {
    const data = d.data();
    if (data.email) emailToUid[data.email.toLowerCase()] = d.id;
  });

  console.log('Email → UID map:', emailToUid);

  let count = 0;
  for (const t of tasks) {
    const primaryEmail = t.emails[0] || '';
    const primaryUid   = emailToUid[primaryEmail.toLowerCase()] || '';
    const primaryName  = t.assignees[0] || '';

    await db.collection('tasks').add({
      title:            t.title,
      description:      '',
      status:           t.status,
      priority:         t.priority,
      dueDate:          t.due,
      department:       t.dept,
      assignedTo:       primaryUid,
      assignedToName:   primaryName,
      assignedEmail:    primaryEmail,
      allAssignees:     t.assignees,
      allAssigneeEmails:t.emails,
      source:           'clickup_import',
      createdBy:        '',
      createdByName:    'Imported from ClickUp',
      createdAt:        firebase.firestore.FieldValue.serverTimestamp()
    });
    count++;
    console.log(`✅ ${count}. ${t.title} [${t.dept}]`);
  }

  console.log(`\n🎉 Done! ${count} tasks imported to Firestore.`);
  alert(`✅ Done! ${count} tasks imported. Refresh the Tasks page.`);
})();
