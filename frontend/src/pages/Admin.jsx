import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { api } from '../api/client';
import DataTable from '../components/DataTable';
import { useCompanyContext } from '../context/CompanyContext';

const label = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, marginTop: 12 };
const inputStyle = { display: 'block', width: '100%', padding: 8, boxSizing: 'border-box' };
const section = { marginBottom: 40 };

const emptyUserForm = { email: '', full_name: '', role_id: '', temp_password: '' };
const emptyEventForm = { id: null, code: '', name: '', event_year: '', start_date: '', end_date: '', parent_event_id: '', tier: 'EDITION', venue: '' };
const emptyTaxCodeForm = { id: null, code: '', name: '', rate_pct: '' };
const emptyRuleForm = {
  id: null, trigger_type: 'DISCOUNT_ABOVE_THRESHOLD', threshold_type: '', threshold_value: '',
  approver_type: 'ROLE', approver_role_code: 'ADM', approver_user_id: '',
  event_id: '', backup_approver_user_id: '',
  escalate_after_days: '', escalate_to_type: 'ROLE', escalate_to_role_code: 'ADM', escalate_to_user_id: '',
  use_step2: false, step2_approver_type: 'ROLE', step2_approver_role_code: 'MGT', step2_approver_user_id: '',
};
// NEW_CONTRACT used to be an opt-in trigger for the new-contract approval
// gate — that gate is now mandatory for every contract regardless (see the
// Draft -> Send for Approval flow), so it's no longer a configurable rule.
// TAX_CHANGE was retired 2026-07-23 — a tax code change on an approved
// contract is just one flavour of POST_APPROVAL_EDIT, which already covers
// it, so having both was redundant. Both are kept in TRIGGER_LABELS (not
// this list) so any old rows still display correctly.
const SELECTABLE_TRIGGERS = [
  'DISCOUNT_ABOVE_THRESHOLD', 'REVENUE_ABOVE_THRESHOLD', 'POST_APPROVAL_EDIT', 'CREDIT_NOTE_ISSUED', 'CONTRACT_REDUCTION', 'BUDGET_APPROVAL',
  'INVOICE_CONFIRM', 'CREDIT_NOTE_CONFIRM', 'PAYMENT_RECORD',
];
// Trigger types with no threshold at all — "who is allowed to do this",
// not "above what amount". Rendered without the threshold input, and
// without the automatic Admin/Management bypass every threshold tier gets
// (see backend/src/utils/approverMatrix.js's canActOnFinanceGate) — these
// three were previously hardcoded to Finance only, Admin explicitly
// excluded, and stay that strict even once configured here.
const NO_THRESHOLD_TRIGGERS = ['INVOICE_CONFIRM', 'CREDIT_NOTE_CONFIRM', 'PAYMENT_RECORD'];
const emptyProfileForm = {
  reg_no: '', tin_no: '', sst_no: '', address: '', phone: '', email: '',
  bank_name: '', bank_account_no: '', bank_swift: '', payment_instructions: '',
  budget_preparer_user_id: '', budget_approver_user_id: '', contract_terms: '', event_name: '',
  stamp_duty_enabled: false, stamp_duty_rate_pct: '0.5', stamp_duty_round_to: '5', stamp_duty_minimum: '10',
};
const emptyExpenseCodeForm = { id: null, code: '', description: '', type: 'EXPENSE' };

const TRIGGER_LABELS = {
  NEW_CONTRACT: 'New contract submitted',
  DISCOUNT_ABOVE_THRESHOLD: 'Line item discount above threshold',
  TAX_CHANGE: 'Tax code changed on an approved contract (retired — see "Contract edited after approval")',
  REVENUE_ABOVE_THRESHOLD: 'Contract total value above threshold',
  POST_APPROVAL_EDIT: 'Contract edited after approval above threshold',
  CREDIT_NOTE_ISSUED: 'Credit note above threshold',
  CONTRACT_REDUCTION: 'Contract value change above threshold',
  BUDGET_APPROVAL: 'Budget preparer & approver',
  INVOICE_CONFIRM: 'Who can confirm an invoice',
  CREDIT_NOTE_CONFIRM: 'Who can confirm a credit note',
  PAYMENT_RECORD: 'Who can record/edit/remove a payment',
};

// Shown inline, only for whichever trigger is currently selected in the Add/
// Edit Rule form — replaces a permanently-visible reference table that took
// up screen space and (per user feedback) read as if it were itself a set
// of active rules rather than just explanatory text.
const TRIGGER_HELP = {
  DISCOUNT_ABOVE_THRESHOLD: "Fires when any contract line's discount exceeds the % or flat amount below, on a new or existing contract.",
  REVENUE_ABOVE_THRESHOLD: "Fires when a contract's total (in MYR) crosses the amount below. Add several of these to build a tiered matrix — e.g. RM100,000 to a Finance Manager, RM1,000,000 to a CFO — LowForce uses whichever threshold is the highest one the contract still clears (not every tier at once). To set who approves by DEFAULT (any contract below your lowest real tier, or if you're not using tiers at all), add one rule with a threshold of 0 — it becomes the base approver for everything else. With no rule configured at all, any Admin/Management can approve; Admin always can, regardless of tier. Optionally require a 2nd approval below (e.g. Finance then Management) for your highest tier.",
  POST_APPROVAL_EDIT: "Fires when a change (price, tax code, item, discount) to a contract that was already approved leaves its total at or above the amount below — including a tax code change, which is just one kind of this. Add several of these to build a tiered matrix by contract value, same as Contract total value above threshold, and optionally require a 2nd approval for your highest tier.",
  CREDIT_NOTE_ISSUED: "Fires when a credit note issued against an invoice/contract exceeds the amount below.",
  CONTRACT_REDUCTION: "Fires when a Reduce Contract request's reduction amount (in MYR) exceeds the amount below — covers the whole request, including any Credit Note(s) it auto-generates against already-invoiced amounts, as one combined approval.",
  BUDGET_APPROVAL: 'A separate approval chain for the Budget module — a fixed named person to prepare, a fixed named person to approve, rather than a role or threshold. Admin can also always prepare or approve as a fallback.',
  INVOICE_CONFIRM: "Controls who can confirm an invoice (and edit its number/date/amount/rate once issued) — this is the point an invoice becomes a real financial document. With no rule configured, only the Finance role can do this — not even Admin/Management, unless you add a rule here naming a different role or person. That exclusion stays in force even once a rule is added; there is no automatic Admin override for this one.",
  CREDIT_NOTE_CONFIRM: "Controls who can confirm a credit note — the point it actually reduces its invoice's outstanding balance. Same rule as Invoice Confirm: defaults to Finance only, no automatic Admin override even once configured.",
  PAYMENT_RECORD: "Controls who can record, edit or remove a payment. Same rule as Invoice Confirm: defaults to Finance only, no automatic Admin override even once configured.",
};

const TABS = [
  { key: 'users', label: 'Users' },
  { key: 'events', label: 'Events' },
  { key: 'exchange-rate', label: 'Exchange Rate' },
  { key: 'company-profile', label: 'Company Profile' },
  { key: 'tax-codes', label: 'Tax Codes' },
  { key: 'expense-codes', label: 'Expense Codes' },
  { key: 'segments', label: 'Segments' },
  { key: 'data-import', label: 'Data Import' },
  { key: 'departments', label: 'Departments' },
  { key: 'approval-rules', label: 'Approval Rules' },
  { key: 'audit-log', label: 'Audit Log' },
  { key: 'archived-records', label: 'Archived Records' },
  { key: 'email-templates', label: 'Email Templates' },
];

const EMAIL_TEMPLATE_LABELS = {
  TAX_DETAIL_LINK: 'Tax Detail Link',
  STATEMENT_OF_ACCOUNT: 'Statement of Account',
  OUTSTANDING_REMINDER: 'Outstanding Payment Reminder',
  USER_INVITE: 'New User Invite (Data Import > Users)',
};
const EMAIL_TEMPLATE_KEYS = Object.keys(EMAIL_TEMPLATE_LABELS);

// Matches backend/src/middleware/modulePermission.js's ACTION_RANK and
// admin.controller.js's MODULE_NAMES — the small, bounded set of modules
// this round's Department access matrix actually gates. 'add' means
// create-only: new records are allowed, but existing ones can't be
// edited/overwritten — a company can have a data-entry role that logs new
// leads/contracts without being able to tamper with ones already saved.
const PERMISSION_MODULES = [
  { key: 'exhibitors', label: 'Exhibitors' },
  { key: 'opportunities', label: 'Opportunities' },
  { key: 'contracts', label: 'Contracts' },
  { key: 'invoices', label: 'Invoices' },
];
const PERMISSION_LEVEL_LABELS = { view: 'View only', add: 'View + Add (no edit)', edit: 'Full edit' };

const AUDIT_ACTIONS = ['LOGIN', 'FAILED_LOGIN', 'LOGOUT', 'POST', 'PUT', 'PATCH', 'DELETE'];
const emptyAuditFilters = { from: '', to: '', user_id: '', entity_type: '', action: '' };

// Matches archive.controller.js's ENTITIES keys — path is where Restore
// links back to so an Admin can jump straight to the record afterward.
const ARCHIVE_TYPES = [
  { key: 'exhibitor', label: 'Exhibitors', path: '/exhibitors' },
  { key: 'opportunity', label: 'Opportunities', path: '/opportunities' },
  { key: 'contract', label: 'Contracts', path: '/sales-orders' },
  { key: 'invoice', label: 'Invoices', path: '/invoices' },
  { key: 'creditnote', label: 'Credit Notes', path: '/credit-notes' },
  { key: 'payment', label: 'Payments', path: '/payments' },
];

export default function Admin({ user }) {
  const { refresh: refreshCompany } = useCompanyContext();
  const [activeTab, setActiveTab] = useState('users');
  // Group resource sharing (migration 079) — whether this company lets
  // sibling companies in its group see its exhibitors in search.
  const [groupInfo, setGroupInfo] = useState(null);
  const [sharing, setSharing] = useState({});
  const [savingSharing, setSavingSharing] = useState('');
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [newRoleForm, setNewRoleForm] = useState({ code: '', name: '' });
  const [editingRoleId, setEditingRoleId] = useState(null);
  const [roleEditForm, setRoleEditForm] = useState({ name: '', permissions: {} });
  const [roleBusy, setRoleBusy] = useState(false);
  const [events, setEvents] = useState([]);
  const [userForm, setUserForm] = useState(emptyUserForm);
  const [showUserForm, setShowUserForm] = useState(false);
  const [eventForm, setEventForm] = useState(emptyEventForm);
  const [showEventForm, setShowEventForm] = useState(false);
  const [error, setError] = useState('');

  const [taxCodes, setTaxCodes] = useState([]);
  const [taxCodeForm, setTaxCodeForm] = useState(emptyTaxCodeForm);
  const [showTaxCodeForm, setShowTaxCodeForm] = useState(false);
  const [exchangeRate, setExchangeRate] = useState('');
  const [savingRate, setSavingRate] = useState(false);
  const [profileForm, setProfileForm] = useState(emptyProfileForm);
  const [branding, setBranding] = useState({ logo: false, letterhead: false, footer: false, event_logo: false, contract_terms_pdf: false });
  const [brandingBust, setBrandingBust] = useState(0); // cache-buster after upload/delete
  const [brandingUploading, setBrandingUploading] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [rules, setRules] = useState([]);
  const [ruleForm, setRuleForm] = useState(emptyRuleForm);
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [expenseCodes, setExpenseCodes] = useState([]);
  const [expenseCodeForm, setExpenseCodeForm] = useState(emptyExpenseCodeForm);
  const [showExpenseCodeForm, setShowExpenseCodeForm] = useState(false);
  const [segments, setSegments] = useState(null);
  const [segMainForm, setSegMainForm] = useState({ id: '', code: '', name: '' });
  const [showSegMainForm, setShowSegMainForm] = useState(false);
  const [segSubForm, setSegSubForm] = useState({ id: '', segment_main_id: '', code: '', name: '' });
  const [showSegSubForm, setShowSegSubForm] = useState(false);
  const [segImporting, setSegImporting] = useState(false);
  const [segImportResult, setSegImportResult] = useState(null);
  const [repeatImporting, setRepeatImporting] = useState(false);
  const [repeatImportResult, setRepeatImportResult] = useState(null);
  const [exhibitorImporting, setExhibitorImporting] = useState(false);
  const [exhibitorImportResult, setExhibitorImportResult] = useState(null);
  const [agentImporting, setAgentImporting] = useState(false);
  const [agentImportResult, setAgentImportResult] = useState(null);
  const [expenseCodeImporting, setExpenseCodeImporting] = useState(false);
  const [expenseCodeImportResult, setExpenseCodeImportResult] = useState(null);
  const [userImportMode, setUserImportMode] = useState('temp_password');
  const [userImporting, setUserImporting] = useState(false);
  const [userImportResult, setUserImportResult] = useState(null);

  const [auditFilters, setAuditFilters] = useState(emptyAuditFilters);
  const [auditEntries, setAuditEntries] = useState(null);
  const [auditEntityTypes, setAuditEntityTypes] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);

  function loadAuditLog() {
    setAuditLoading(true);
    const params = Object.fromEntries(Object.entries(auditFilters).filter(([, v]) => v));
    api.listAuditLog(params)
      .then(({ entries, entityTypes }) => { setAuditEntries(entries); setAuditEntityTypes(entityTypes); })
      .catch((err) => setError(err.message))
      .finally(() => setAuditLoading(false));
  }

  const [archiveType, setArchiveType] = useState('exhibitor');
  const [archivedRecords, setArchivedRecords] = useState(null);
  const [archiveLoading, setArchiveLoading] = useState(false);

  function loadArchived(type) {
    setArchiveLoading(true);
    api.listArchivedRecords(type)
      .then(({ records }) => setArchivedRecords(records))
      .catch((err) => setError(err.message))
      .finally(() => setArchiveLoading(false));
  }

  async function handleRestore(type, id) {
    if (!window.confirm('Restore this record? It reappears everywhere immediately.')) return;
    try {
      await api.restoreRecord(type, id);
      loadArchived(type);
    } catch (err) {
      setError(err.message);
    }
  }

  function loadSegments() {
    api.listSegments()
      .then(({ segments }) => setSegments(segments))
      .catch((err) => setError(err.message));
  }

  async function handleSaveSegMain(e) {
    e.preventDefault();
    try {
      if (segMainForm.id) {
        await api.updateSegmentMain(segMainForm.id, { code: segMainForm.code, name: segMainForm.name });
      } else {
        await api.createSegmentMain({ code: segMainForm.code, name: segMainForm.name });
      }
      setSegMainForm({ id: '', code: '', name: '' });
      setShowSegMainForm(false);
      loadSegments();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteSegMain(m) {
    if (!window.confirm(`Delete segment "${m.name}"? This also removes any Sub-Segments under it.`)) return;
    try {
      await api.deleteSegmentMain(m.id);
      loadSegments();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSaveSegSub(e) {
    e.preventDefault();
    try {
      if (segSubForm.id) {
        await api.updateSegmentSub(segSubForm.id, { code: segSubForm.code, name: segSubForm.name });
      } else {
        await api.createSegmentSub({
          segment_main_id: segSubForm.segment_main_id, code: segSubForm.code, name: segSubForm.name,
        });
      }
      setSegSubForm({ id: '', segment_main_id: '', code: '', name: '' });
      setShowSegSubForm(false);
      loadSegments();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteSegSub(s) {
    if (!window.confirm(`Delete sub-segment "${s.name}"?`)) return;
    try {
      await api.deleteSegmentSub(s.id);
      loadSegments();
    } catch (err) {
      setError(err.message);
    }
  }

  function handleDownloadSegmentTemplate() {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Main Code *', 'Main Name *', 'Sub Code', 'Sub Name'],
      ['ASSOC', 'ASSOCIATION', 'ASSOC-TRADE', 'TRADE ASSOCIATION'],
      ['ASSOC', 'ASSOCIATION', 'ASSOC-PROF', 'PROFESSIONAL BODY'],
      ['GOVT', 'GOVERNMENT', '', ''],
      ['', '', '', '', '* = mandatory. Delete the sample rows above before importing your real data. Sub Code/Sub Name are optional but must both be filled to create a subcategory.'],
    ]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Segments');
    XLSX.writeFile(book, 'segment_template.csv');
  }

  async function handleUploadSegmentFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSegImporting(true);
    setSegImportResult(null);
    try {
      const data = await file.arrayBuffer();
      const book = XLSX.read(data, { type: 'array' });
      const sheet = book.Sheets[book.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      const rows = json.map((r) => ({
        main_code: r['Main Code *'] ?? r['Main Code'] ?? r['main_code'] ?? '',
        main_name: r['Main Name *'] ?? r['Main Name'] ?? r['main_name'] ?? '',
        sub_code: r['Sub Code'] ?? r['sub_code'] ?? '',
        sub_name: r['Sub Name'] ?? r['sub_name'] ?? '',
      })).filter((r) => r.main_code || r.main_name);
      const result = await api.importSegments(rows);
      setSegImportResult(result);
      loadSegments();
    } catch (err) {
      setError(err.message);
    } finally {
      setSegImporting(false);
      e.target.value = '';
    }
  }

  function handleDownloadRepeatTemplate() {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Company Name *'],
      ['ACME EXHIBITIONS SDN BHD'],
      ['GLOBAL PACKAGING SOLUTIONS SDN BHD'],
      ['* = mandatory. Delete the sample rows above before importing your real data. Matched against your existing Exhibitor list by company name.'],
    ]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Repeat Exhibitors');
    XLSX.writeFile(book, 'repeat_exhibitor_template.csv');
  }

  async function handleUploadRepeatFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setRepeatImporting(true);
    setRepeatImportResult(null);
    try {
      const data = await file.arrayBuffer();
      const book = XLSX.read(data, { type: 'array' });
      const sheet = book.Sheets[book.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      const rows = json.map((r) => ({
        company_name: r['Company Name *'] ?? r['Company Name'] ?? r['company_name'] ?? '',
      })).filter((r) => r.company_name && !r.company_name.startsWith('* = mandatory'));
      const result = await api.importRepeatExhibitors(rows);
      setRepeatImportResult(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setRepeatImporting(false);
      e.target.value = '';
    }
  }

  function handleDownloadExhibitorTemplate() {
    const sheet = XLSX.utils.aoa_to_sheet([
      [
        'Company Name *', 'Name (Alt)', 'Country Code', 'Address', 'Postcode', 'City', 'State',
        'Reg No', 'TIN No', 'SST No', 'Website', 'Fax',
        'Contact 1 Name', 'Contact 1 Job Title', 'Contact 1 Phone', 'Contact 1 Email',
        'Contact 2 Name', 'Contact 2 Job Title', 'Contact 2 Phone', 'Contact 2 Email',
        'Salesperson Email', 'Agent Name', 'Billing Company', 'Event Codes',
      ],
      [
        'ACME EXHIBITIONS SDN BHD', 'ACME EXPO', 'MY', '12 JALAN AMPANG', '50450', 'KUALA LUMPUR', 'W.P. KUALA LUMPUR',
        '199901012345', 'C1234567890', 'W10-1234-56789012', 'https://acme-exhibitions.example.com', '60312345679',
        'JANE TAN', 'MARKETING MANAGER', '60123456789', 'jane.tan@acme-exhibitions.example.com',
        'AHMAD FAIZAL', 'FINANCE EXECUTIVE', '60129876543', 'ahmad.faizal@acme-exhibitions.example.com',
        'salesperson@example.com', 'ACME TRAVEL & EVENTS', '', events.map((ev) => ev.code).slice(0, 2).join(', ') || 'MIFB27',
      ],
      [
        '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
        '', '', '', '* = mandatory. Delete the sample row above before importing your real data. Contact/phone numbers '
          + 'must be digits only (no +, spaces, or dashes — required for WhatsApp links). Everything is trimmed and '
          + 'converted to UPPERCASE on import except Website and email addresses. Salesperson Email / Agent Name / '
          + 'Billing Company are matched by exact text against existing Users/Agents/Exhibitors — leave blank if not applicable. '
          + 'Event Codes: which main and/or sub events this exhibitor takes part in, comma-separated — '
          + `valid codes for this company: ${events.map((ev) => ev.code).join(', ') || '(none set up yet — add Events first)'}. `
          + 'Leave blank to leave existing event participation untouched.',
      ],
    ]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Exhibitors');
    XLSX.writeFile(book, 'exhibitor_template.csv');
  }

  async function handleUploadExhibitorFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setExhibitorImporting(true);
    setExhibitorImportResult(null);
    try {
      const data = await file.arrayBuffer();
      const book = XLSX.read(data, { type: 'array' });
      const sheet = book.Sheets[book.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      const rows = json.map((r) => ({
        company_name: r['Company Name *'] ?? r['Company Name'] ?? r['company_name'] ?? '',
        company_name_alt: r['Name (Alt)'] ?? r['company_name_alt'] ?? '',
        country_code: r['Country Code'] ?? r['country_code'] ?? '',
        address: r['Address'] ?? r['address'] ?? '',
        postcode: r['Postcode'] ?? r['postcode'] ?? '',
        city: r['City'] ?? r['city'] ?? '',
        state: r['State'] ?? r['state'] ?? '',
        reg_no: r['Reg No'] ?? r['reg_no'] ?? '',
        tin_no: r['TIN No'] ?? r['tin_no'] ?? '',
        sst_no: r['SST No'] ?? r['sst_no'] ?? '',
        website: r['Website'] ?? r['website'] ?? '',
        fax: r['Fax'] ?? r['fax'] ?? '',
        contact1_name: r['Contact 1 Name'] ?? r['contact1_name'] ?? '',
        contact1_job_title: r['Contact 1 Job Title'] ?? r['contact1_job_title'] ?? '',
        contact1_phone: r['Contact 1 Phone'] ?? r['contact1_phone'] ?? '',
        contact1_email: r['Contact 1 Email'] ?? r['contact1_email'] ?? '',
        contact2_name: r['Contact 2 Name'] ?? r['contact2_name'] ?? '',
        contact2_job_title: r['Contact 2 Job Title'] ?? r['contact2_job_title'] ?? '',
        contact2_phone: r['Contact 2 Phone'] ?? r['contact2_phone'] ?? '',
        contact2_email: r['Contact 2 Email'] ?? r['contact2_email'] ?? '',
        salesperson_email: r['Salesperson Email'] ?? r['salesperson_email'] ?? '',
        agent_name: r['Agent Name'] ?? r['agent_name'] ?? '',
        billing_company_name: r['Billing Company'] ?? r['billing_company_name'] ?? '',
        event_codes: r['Event Codes'] ?? r['event_codes'] ?? '',
      })).filter((r) => r.company_name);
      const result = await api.importExhibitors(rows);
      setExhibitorImportResult(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setExhibitorImporting(false);
      e.target.value = '';
    }
  }

  function handleDownloadAgentTemplate() {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Name *', 'Name (Alt)', 'Country Code', 'Address', 'Postcode', 'City', 'State', 'Reg No', 'TIN No', 'SST No', 'Website', 'Fax', 'Salesperson Email'],
      ['ACME TRAVEL & EVENTS', 'ACME T&E', 'MY', '8 JALAN BUKIT BINTANG', '55100', 'KUALA LUMPUR', 'W.P. KUALA LUMPUR', '199801098765', 'C9876543210', 'W10-9876-54321098', 'https://acme-travel.example.com', '60323456780', 'salesperson@example.com'],
      ['', '', '', '', '', '', '', '', '', '', '', '', '* = mandatory. Delete the sample row above before importing your real data. Trimmed and converted to UPPERCASE on import except Website. Salesperson Email is matched by exact text against existing Users — leave blank if not applicable.'],
    ]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Agents');
    XLSX.writeFile(book, 'agent_template.csv');
  }

  async function handleUploadAgentFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAgentImporting(true);
    setAgentImportResult(null);
    try {
      const data = await file.arrayBuffer();
      const book = XLSX.read(data, { type: 'array' });
      const sheet = book.Sheets[book.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      const rows = json.map((r) => ({
        name: r['Name *'] ?? r['Name'] ?? r['name'] ?? '',
        name_alt: r['Name (Alt)'] ?? r['name_alt'] ?? '',
        country_code: r['Country Code'] ?? r['country_code'] ?? '',
        address: r['Address'] ?? r['address'] ?? '',
        postcode: r['Postcode'] ?? r['postcode'] ?? '',
        city: r['City'] ?? r['city'] ?? '',
        state: r['State'] ?? r['state'] ?? '',
        reg_no: r['Reg No'] ?? r['reg_no'] ?? '',
        tin_no: r['TIN No'] ?? r['tin_no'] ?? '',
        sst_no: r['SST No'] ?? r['sst_no'] ?? '',
        website: r['Website'] ?? r['website'] ?? '',
        fax: r['Fax'] ?? r['fax'] ?? '',
        salesperson_email: r['Salesperson Email'] ?? r['salesperson_email'] ?? '',
      })).filter((r) => r.name);
      const result = await api.importAgents(rows);
      setAgentImportResult(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setAgentImporting(false);
      e.target.value = '';
    }
  }

  function handleDownloadExpenseCodeTemplate() {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Code *', 'Description *', 'Type (EXPENSE or REVENUE)'],
      ['MKT-001', 'MARKETING & ADVERTISING', 'EXPENSE'],
      ['REV-001', 'SPONSORSHIP INCOME', 'REVENUE'],
      ['* = mandatory. Delete the sample rows above before importing your real data.', '', 'Type defaults to EXPENSE if left blank.'],
    ]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Expense Codes');
    XLSX.writeFile(book, 'expense_code_template.csv');
  }

  async function handleUploadExpenseCodeFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setExpenseCodeImporting(true);
    setExpenseCodeImportResult(null);
    try {
      const data = await file.arrayBuffer();
      const book = XLSX.read(data, { type: 'array' });
      const sheet = book.Sheets[book.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      const rows = json.map((r) => ({
        code: r['Code *'] ?? r['Code'] ?? r['code'] ?? '',
        description: r['Description *'] ?? r['Description'] ?? r['description'] ?? '',
        type: r['Type (EXPENSE or REVENUE)'] ?? r['Type'] ?? r['type'] ?? 'EXPENSE',
      })).filter((r) => r.code && !r.code.startsWith('* = mandatory'));
      const result = await api.importExpenseCodes(rows);
      setExpenseCodeImportResult(result);
      api.listExpenseCodes().then(({ expenseCodes }) => setExpenseCodes(expenseCodes));
    } catch (err) {
      setError(err.message);
    } finally {
      setExpenseCodeImporting(false);
      e.target.value = '';
    }
  }

  function handleDownloadUserTemplate() {
    const validCodes = roles.map((r) => r.code).join(', ') || 'e.g. SALES, FIN, MGT, ADM';
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Email *', 'Full Name *', 'Role Code *'],
      ['jane.doe@example.com', 'JANE DOE', roles[0]?.code || 'SALES'],
      ['* = mandatory. Delete the sample row above before importing your real data.', '', `Valid role codes for this company: ${validCodes}`],
    ]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Users');
    XLSX.writeFile(book, 'user_template.csv');
  }

  async function handleUploadUserFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUserImporting(true);
    setUserImportResult(null);
    try {
      const data = await file.arrayBuffer();
      const book = XLSX.read(data, { type: 'array' });
      const sheet = book.Sheets[book.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      const rows = json.map((r) => ({
        email: r['Email *'] ?? r['Email'] ?? r['email'] ?? '',
        full_name: r['Full Name *'] ?? r['Full Name'] ?? r['full_name'] ?? '',
        role_code: r['Role Code *'] ?? r['Role Code'] ?? r['role_code'] ?? '',
      })).filter((r) => r.email && !r.email.startsWith('* = mandatory'));
      const result = await api.adminImportUsers(rows);
      setUserImportResult(result);
      loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setUserImporting(false);
      e.target.value = '';
    }
  }

  async function copyUserInvite(user) {
    try {
      const { template } = await api.getEmailTemplate('USER_INVITE');
      const vars = { full_name: user.full_name, email: user.email, temp_password: user.temp_password, company_name: '', sender_name: '' };
      const fill = (text) => text.replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] ? vars[k] : m));
      await navigator.clipboard.writeText(`Subject: ${fill(template.subject)}\n\n${fill(template.body)}`);
    } catch (err) {
      setError(err.message);
    }
  }

  // Actually delivers the invite via SMTP instead of drafting it for the
  // Admin to send by hand — falls back to a clear message (not a crash) if
  // this server doesn't have SMTP_HOST/PORT/USER/PASSWORD set yet.
  const [invitingEmail, setInvitingEmail] = useState('');
  async function sendUserInvite(user) {
    setInvitingEmail(user.email);
    try {
      await api.sendUserInviteEmail(user);
      window.alert(`Invite email sent to ${user.email}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setInvitingEmail('');
    }
  }

  // Wording used when drafting the Tax Detail Link / Statement of Account /
  // Outstanding Reminder emails (see EmailDraftPanel.jsx) — company-
  // configurable per the standing "nothing hardcoded" rule, editable here
  // by Admin/Management only.
  const [emailTemplateDrafts, setEmailTemplateDrafts] = useState({});
  const [savingTemplateKey, setSavingTemplateKey] = useState('');

  function loadEmailTemplates() {
    api.listEmailTemplates()
      .then(({ templates }) => {
        const byKey = Object.fromEntries(templates.map((t) => [t.template_key, { subject: t.subject, body: t.body }]));
        setEmailTemplateDrafts(byKey);
      })
      .catch((err) => setError(err.message));
  }

  async function handleSaveEmailTemplate(key) {
    setSavingTemplateKey(key);
    try {
      await api.updateEmailTemplate(key, emailTemplateDrafts[key]);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingTemplateKey('');
    }
  }

  function loadAll() {
    api.adminListUsers().then(({ users }) => setUsers(users));
    api.adminListEvents().then(({ events }) => setEvents(events));
  }

  function loadCurrencyAndApprovals() {
    api.listTaxCodes().then(({ taxCodes }) => setTaxCodes(taxCodes));
    api.listExpenseCodes().then(({ expenseCodes }) => setExpenseCodes(expenseCodes));
    api.getSettings().then(({ settings, group, sharing }) => {
      setExchangeRate(settings.usd_to_myr_rate);
      setGroupInfo(group || null);
      setSharing(sharing || {});
      setProfileForm({
        reg_no: settings.reg_no || '', tin_no: settings.tin_no || '', sst_no: settings.sst_no || '',
        address: settings.address || '', phone: settings.phone || '', email: settings.email || '',
        bank_name: settings.bank_name || '', bank_account_no: settings.bank_account_no || '',
        bank_swift: settings.bank_swift || '', payment_instructions: settings.payment_instructions || '',
        budget_preparer_user_id: settings.budget_preparer_user_id || '',
        budget_approver_user_id: settings.budget_approver_user_id || '',
        contract_terms: settings.contract_terms || '',
        event_name: settings.event_name || '',
        stamp_duty_enabled: settings.stamp_duty_enabled || false,
        stamp_duty_rate_pct: settings.stamp_duty_rate_pct ?? '0.5',
        stamp_duty_round_to: settings.stamp_duty_round_to ?? '5',
        stamp_duty_minimum: settings.stamp_duty_minimum ?? '10',
      });
      setBranding({
        logo: settings.has_logo, letterhead: settings.has_letterhead, footer: settings.has_footer,
        event_logo: settings.has_event_logo, contract_terms_pdf: settings.has_contract_terms_pdf,
      });
    });
    api.listApprovalRules().then(({ rules }) => setRules(rules));
  }

  function loadRoles() {
    api.adminListRoles().then(({ roles }) => setRoles(roles));
  }

  async function handleCreateRole(e) {
    e.preventDefault();
    setError('');
    if (!newRoleForm.code || !newRoleForm.name) return;
    setRoleBusy(true);
    try {
      await api.adminCreateRole({ code: newRoleForm.code, name: newRoleForm.name });
      setNewRoleForm({ code: '', name: '' });
      loadRoles();
    } catch (err) {
      setError(err.message);
    } finally {
      setRoleBusy(false);
    }
  }

  function openRoleEditor(role) {
    setEditingRoleId(role.id);
    setRoleEditForm({ name: role.name, permissions: { ...(role.permissions || {}) } });
  }

  function setRolePermission(moduleKey, level) {
    setRoleEditForm((f) => {
      const next = { ...f.permissions };
      if (level) next[moduleKey] = level; else delete next[moduleKey];
      return { ...f, permissions: next };
    });
  }

  async function handleSaveRole() {
    setRoleBusy(true);
    setError('');
    try {
      await api.adminUpdateRole(editingRoleId, { name: roleEditForm.name, permissions: roleEditForm.permissions });
      setEditingRoleId(null);
      loadRoles();
    } catch (err) {
      setError(err.message);
    } finally {
      setRoleBusy(false);
    }
  }

  async function handleDeleteRole(role) {
    if (!window.confirm(`Delete the "${role.name}" department? Only possible if no user is currently assigned it.`)) return;
    setError('');
    try {
      await api.adminDeleteRole(role.id);
      loadRoles();
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    loadAll();
    loadCurrencyAndApprovals();
    loadRoles();
  }, []);

  // Loads lazily the first time the tab is opened, then only again when the
  // user clicks Search — not on every keystroke in the filter fields.
  useEffect(() => {
    if (activeTab === 'audit-log' && auditEntries === null) loadAuditLog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'email-templates' && Object.keys(emailTemplateDrafts).length === 0) loadEmailTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'segments' && segments === null) loadSegments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'archived-records') loadArchived(archiveType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, archiveType]);

  // --- Tax codes & exchange rate --------------------------------------------

  async function handleSaveTaxCode(e) {
    e.preventDefault();
    setError('');
    if (!window.confirm(taxCodeForm.id ? `Save changes to ${taxCodeForm.code}?` : `Add tax code ${taxCodeForm.code}?`)) return;
    try {
      const { id, ...payload } = taxCodeForm;
      if (id) {
        await api.updateTaxCode(id, { name: payload.name, rate_pct: payload.rate_pct });
      } else {
        await api.createTaxCode(payload);
      }
      setTaxCodeForm(emptyTaxCodeForm);
      setShowTaxCodeForm(false);
      loadCurrencyAndApprovals();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleToggleTaxCodeActive(tc) {
    setError('');
    if (!window.confirm(`${tc.is_active ? 'Deactivate' : 'Activate'} ${tc.code}?`)) return;
    try {
      await api.updateTaxCode(tc.id, { is_active: !tc.is_active });
      loadCurrencyAndApprovals();
    } catch (err) {
      setError(err.message);
    }
  }

  // --- Expense codes (Budget module) ----------------------------------------

  async function handleSaveExpenseCode(e) {
    e.preventDefault();
    setError('');
    if (!window.confirm(expenseCodeForm.id ? `Save changes to ${expenseCodeForm.code}?` : `Add expense code ${expenseCodeForm.code}?`)) return;
    try {
      const { id, ...payload } = expenseCodeForm;
      if (id) {
        await api.updateExpenseCode(id, { description: payload.description, type: payload.type });
      } else {
        await api.createExpenseCode(payload);
      }
      setExpenseCodeForm(emptyExpenseCodeForm);
      setShowExpenseCodeForm(false);
      loadCurrencyAndApprovals();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleToggleExpenseCodeActive(ec) {
    setError('');
    if (!window.confirm(`${ec.is_active ? 'Deactivate' : 'Activate'} ${ec.code}?`)) return;
    try {
      await api.updateExpenseCode(ec.id, { is_active: !ec.is_active });
      loadCurrencyAndApprovals();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSaveExchangeRate(e) {
    e.preventDefault();
    setError('');
    if (!window.confirm(`Set the default USD:MYR rate to 1:${exchangeRate}? This only affects contracts not yet invoiced — Finance enters the real rate per invoice.`)) return;
    setSavingRate(true);
    try {
      await api.updateSettings({ usd_to_myr_rate: exchangeRate });
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingRate(false);
    }
  }

  async function handleSaveProfile(e) {
    e.preventDefault();
    setError('');
    if (!window.confirm('Save the company profile? This appears as the letterhead on every printed contract, invoice and receipt.')) return;
    setSavingProfile(true);
    try {
      await api.updateSettings(profileForm);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleUploadBranding(type, file) {
    if (!file) return;
    setError('');
    setBrandingUploading(type);
    try {
      await api.uploadBrandingImage(type, file);
      setBranding((b) => ({ ...b, [type]: true }));
      setBrandingBust((n) => n + 1);
      // Nav bar (and anywhere else) reading the shared company/has_logo
      // state needs to know right away, not just this page's own local
      // preview — see CompanyContext.jsx.
      if (type === 'logo') refreshCompany();
    } catch (err) {
      setError(err.message);
    } finally {
      setBrandingUploading('');
    }
  }

  async function handleDeleteBranding(type) {
    if (!window.confirm(`Remove this file? Documents will fall back to plain text where this was used.`)) return;
    setError('');
    try {
      await api.deleteBrandingImage(type);
      setBranding((b) => ({ ...b, [type]: false }));
      setBrandingBust((n) => n + 1);
      if (type === 'logo') refreshCompany();
    } catch (err) {
      setError(err.message);
    }
  }

  // --- Approval rules ---------------------------------------------------------

  async function handleSaveRule(e) {
    e.preventDefault();
    setError('');
    // Budget Approval isn't a real approval_rules row — it's the Budget
    // module's own two-named-people chain on company_settings — but it
    // lives in the same Trigger dropdown so it's discoverable in one place
    // rather than a separate fixed section elsewhere on the page.
    if (ruleForm.trigger_type === 'BUDGET_APPROVAL') {
      if (!window.confirm('Save the Budget Preparer/Approver?')) return;
      try {
        await api.updateSettings({
          budget_preparer_user_id: profileForm.budget_preparer_user_id,
          budget_approver_user_id: profileForm.budget_approver_user_id,
        });
        setRuleForm(emptyRuleForm);
        setShowRuleForm(false);
      } catch (err) {
        setError(err.message);
      }
      return;
    }

    if (!window.confirm(ruleForm.id ? 'Save changes to this rule?' : 'Add this approval rule?')) return;
    try {
      const {
        id, approver_type, escalate_to_type, use_step2, step2_approver_type,
        threshold_type, threshold_value, approver_role_code, approver_user_id, event_id, backup_approver_user_id,
        escalate_after_days, escalate_to_role_code, escalate_to_user_id,
        step2_approver_role_code, step2_approver_user_id,
        ...rest
      } = ruleForm;
      const payload = {
        ...rest,
        threshold_type, threshold_value,
        approver_role_code: approver_type === 'ROLE' ? approver_role_code : null,
        approver_user_id: approver_type === 'PERSON' ? approver_user_id : null,
        event_id: event_id || null,
        backup_approver_user_id: backup_approver_user_id || null,
        escalate_after_days: escalate_after_days || null,
        escalate_to_role_code: escalate_after_days && escalate_to_type === 'ROLE' ? escalate_to_role_code : null,
        escalate_to_user_id: escalate_after_days && escalate_to_type === 'PERSON' ? escalate_to_user_id : null,
        step2_approver_role_code: use_step2 && step2_approver_type === 'ROLE' ? step2_approver_role_code : null,
        step2_approver_user_id: use_step2 && step2_approver_type === 'PERSON' ? step2_approver_user_id : null,
      };
      if (id) {
        await api.updateApprovalRule(id, payload);
      } else {
        await api.createApprovalRule(payload);
      }
      setRuleForm(emptyRuleForm);
      setShowRuleForm(false);
      loadCurrencyAndApprovals();
    } catch (err) {
      setError(err.message);
    }
  }

  function startEditRule(r) {
    setRuleForm({
      id: r.id,
      trigger_type: r.trigger_type,
      threshold_type: r.threshold_type || '',
      threshold_value: r.threshold_value ?? '',
      approver_type: r.approver_user_id ? 'PERSON' : 'ROLE',
      approver_role_code: r.approver_role_code || 'ADM',
      approver_user_id: r.approver_user_id || '',
      event_id: r.event_id || '',
      backup_approver_user_id: r.backup_approver_user_id || '',
      escalate_after_days: r.escalate_after_days ?? '',
      escalate_to_type: r.escalate_to_user_id ? 'PERSON' : 'ROLE',
      escalate_to_role_code: r.escalate_to_role_code || 'ADM',
      escalate_to_user_id: r.escalate_to_user_id || '',
      use_step2: !!(r.step2_approver_role_code || r.step2_approver_user_id),
      step2_approver_type: r.step2_approver_user_id ? 'PERSON' : 'ROLE',
      step2_approver_role_code: r.step2_approver_role_code || 'MGT',
      step2_approver_user_id: r.step2_approver_user_id || '',
    });
    setShowRuleForm(true);
  }

  function startEditBudgetApproval() {
    setRuleForm({ ...emptyRuleForm, trigger_type: 'BUDGET_APPROVAL' });
    setShowRuleForm(true);
  }

  async function handleToggleRuleActive(r) {
    setError('');
    try {
      await api.updateApprovalRule(r.id, { is_active: !r.is_active });
      loadCurrencyAndApprovals();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteRule(r) {
    if (!window.confirm('Delete this approval rule?')) return;
    setError('');
    try {
      await api.deleteApprovalRule(r.id);
      loadCurrencyAndApprovals();
    } catch (err) {
      setError(err.message);
    }
  }

  // --- Users ---------------------------------------------------------------

  async function handleCreateUser(e) {
    e.preventDefault();
    setError('');
    if (!window.confirm(`Create user ${userForm.full_name} (${userForm.email})?`)) return;
    try {
      await api.adminCreateUser(userForm);
      setUserForm(emptyUserForm);
      setShowUserForm(false);
      loadAll();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRoleChange(u, roleId) {
    setError('');
    try {
      await api.adminUpdateUser(u.id, { role_id: roleId });
      loadAll();
    } catch (err) {
      setError(err.message);
    }
  }

  // A simple, whole-account override of the Department module matrix — no
  // per-module choice, per the user's confirmed design (2026-07-31). When
  // set it overrides that matrix across all 4 gated modules; "Default"
  // (empty value) clears it and falls back to the Department matrix again.
  async function handleAccessLevelChange(u, accessLevelOverride) {
    setError('');
    try {
      await api.adminUpdateUser(u.id, { access_level_override: accessLevelOverride || null });
      loadAll();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleToggleActive(u) {
    setError('');
    if (!window.confirm(`${u.is_active ? 'Deactivate' : 'Activate'} ${u.full_name}?`)) return;
    try {
      await api.adminUpdateUser(u.id, { is_active: !u.is_active });
      loadAll();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleResetPassword(u) {
    const newPassword = window.prompt(`New temporary password for ${u.full_name} (min 8 characters, with upper/lowercase, a number, and a special character):`);
    if (!newPassword) return;
    setError('');
    try {
      await api.adminResetPassword(u.id, { new_password: newPassword });
      window.alert(`Password reset. Tell ${u.full_name} to log in with it and change it.`);
    } catch (err) {
      setError(err.message);
    }
  }

  // Lets a user "act as" more than one role (e.g. Admin + Finance) via the
  // switcher in the top nav. Their primary role (set via the dropdown
  // above) is always kept — this only controls the EXTRA roles.
  async function handleToggleUserRole(u, roleId) {
    setError('');
    const current = (u.assigned_roles || []).map((r) => r.id);
    const next = current.includes(roleId) ? current.filter((id) => id !== roleId) : [...current, roleId];
    try {
      await api.adminSetUserRoles(u.id, next);
      loadAll();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleToggleEventAccess(u, eventId) {
    setError('');
    const next = u.event_ids.includes(eventId)
      ? u.event_ids.filter((id) => id !== eventId)
      : [...u.event_ids, eventId];
    try {
      await api.adminSetUserEvents(u.id, { event_ids: next });
      loadAll();
    } catch (err) {
      setError(err.message);
    }
  }

  // --- Events ----------------------------------------------------------------

  function startEditEvent(ev) {
    setEventForm({
      id: ev.id,
      code: ev.code,
      name: ev.name,
      event_year: ev.event_year ?? '',
      start_date: ev.start_date || '',
      end_date: ev.end_date || '',
      parent_event_id: ev.parent_event_id || '',
      tier: ev.tier || 'EDITION',
      venue: ev.venue || '',
    });
    setShowEventForm(true);
  }

  async function handleUploadEventLogo(ev, file) {
    setError('');
    try {
      await api.uploadEventLogo(ev.id, file);
      loadAll();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteEventLogo(ev) {
    if (!window.confirm(`Remove ${ev.name}'s logo?`)) return;
    setError('');
    try {
      await api.deleteEventLogo(ev.id);
      loadAll();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSaveEvent(e) {
    e.preventDefault();
    setError('');
    if (!window.confirm(eventForm.id ? `Save changes to event ${eventForm.code}?` : `Create event ${eventForm.code}?`)) return;
    try {
      if (eventForm.id) {
        const { id, code, ...payload } = eventForm;
        await api.adminUpdateEvent(id, payload);
      } else {
        await api.adminCreateEvent(eventForm);
      }
      setEventForm(emptyEventForm);
      setShowEventForm(false);
      loadAll();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleToggleEventActive(ev) {
    setError('');
    if (!window.confirm(`${ev.is_active ? 'Deactivate' : 'Activate'} event ${ev.code}?`)) return;
    try {
      await api.adminUpdateEvent(ev.id, { is_active: !ev.is_active });
      loadAll();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="page" style={{ maxWidth: 1100, margin: '0 auto 24px' }}>
      {error && <p style={{ color: 'red' }}>{error}</p>}

      {/* Same sticky left sub-menu pattern as Reports — one navigation style
          across every screen with sub-sections. */}
      <div className="report-layout">
        <nav className="report-menu no-print">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={activeTab === t.key ? 'active' : ''}
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="report-content">

      {activeTab === 'users' && (
      <div style={section}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>Users</h3>
          <button onClick={() => { setUserForm(emptyUserForm); setShowUserForm(!showUserForm); }}>
            {showUserForm ? 'Cancel' : '+ Add User'}
          </button>
        </div>

        {showUserForm && (
          <form onSubmit={handleCreateUser} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <label style={label}>Full Name</label>
            <input style={inputStyle} value={userForm.full_name} onChange={(e) => setUserForm({ ...userForm, full_name: e.target.value })} required />
            <label style={label}>Email</label>
            <input type="email" style={inputStyle} value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} required />
            <label style={label}>Role</label>
            <select style={inputStyle} value={userForm.role_id} onChange={(e) => setUserForm({ ...userForm, role_id: e.target.value })} required>
              <option value="">— Select —</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <label style={label}>Temporary Password (min 8 characters, with upper/lowercase, a number, and a special character — the user should change it after first login)</label>
            <input style={inputStyle} value={userForm.temp_password} onChange={(e) => setUserForm({ ...userForm, temp_password: e.target.value })} required />
            <button type="submit" style={{ padding: '8px 16px', marginTop: 16 }}>Create User</button>
          </form>
        )}

        <table width="100%" cellPadding="6">
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Also Acts As</th>
              <th>Event Access</th>
              <th>Access Level</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={{ borderBottom: '1px solid #eee', opacity: u.is_active ? 1 : 0.5 }}>
                <td>{u.full_name}{u.id === user.id ? ' (you)' : ''}</td>
                <td>{u.email}</td>
                <td>
                  <select value={u.role_id || ''} onChange={(e) => handleRoleChange(u, e.target.value)}>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </td>
                <td>
                  {roles.filter((r) => r.id !== u.role_id).map((r) => (
                    <label key={r.id} style={{ fontSize: 12, marginRight: 8, whiteSpace: 'nowrap', display: 'inline-block' }}>
                      <input
                        type="checkbox"
                        checked={(u.assigned_roles || []).some((ar) => ar.id === r.id)}
                        onChange={() => handleToggleUserRole(u, r.id)}
                      />
                      {' '}{r.code}
                    </label>
                  ))}
                </td>
                <td>
                  {['ADM', 'MGT'].includes(u.role_code) ? (
                    <span style={{ fontSize: 12, color: '#5c6070' }}>All events</span>
                  ) : (
                    // Access is granted at main-event level — a grant covers
                    // the main event and all of its sub-events.
                    events.filter((ev) => !ev.parent_event_id).map((ev) => (
                      <label key={ev.id} style={{ fontSize: 12, marginRight: 8, whiteSpace: 'nowrap' }}>
                        <input
                          type="checkbox"
                          checked={u.event_ids.includes(ev.id)}
                          onChange={() => handleToggleEventAccess(u, ev.id)}
                        />
                        {' '}{ev.code}
                      </label>
                    ))
                  )}
                </td>
                <td>
                  <select
                    value={u.access_level_override || ''}
                    onChange={(e) => handleAccessLevelChange(u, e.target.value)}
                    title="Overrides this user's Department module permissions across Exhibitors/Opportunities/Contracts/Invoices when set to anything other than Default"
                  >
                    <option value="">Default</option>
                    <option value="VIEW_ONLY">View only</option>
                    <option value="VIEW_ADD">View + Add (no edit)</option>
                    <option value="FULL_EDIT">Full edit</option>
                  </select>
                </td>
                <td>{u.is_active ? 'Active' : 'Inactive'}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button onClick={() => handleResetPassword(u)}>Reset Password</button>{' '}
                  {u.id !== user.id && (
                    <button onClick={() => handleToggleActive(u)}>{u.is_active ? 'Deactivate' : 'Activate'}</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {activeTab === 'events' && (
      <div style={section}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>Events</h3>
          <button onClick={() => { setEventForm(emptyEventForm); setShowEventForm(!showEventForm); }}>
            {showEventForm ? 'Cancel' : '+ Add Event'}
          </button>
        </div>

        {showEventForm && (
          <form onSubmit={handleSaveEvent} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <label style={label}>Tier</label>
            <p style={{ fontSize: 12, color: '#5c6070', marginTop: 0 }}>
              Main = the brand (e.g. "MIFB", no year — carries its own logo). Edition = a specific year's instance
              (e.g. "MIFB27" — carries the venue, and everything price-list/billing hangs off this level). Category =
              an optional sub-event within an Edition (e.g. "MCE"/"MYFT"). Can't be changed after creation.
            </p>
            <select
              style={inputStyle} value={eventForm.tier} disabled={!!eventForm.id}
              onChange={(e) => setEventForm({ ...eventForm, tier: e.target.value, parent_event_id: '' })}
            >
              <option value="MAIN">Main</option>
              <option value="EDITION">Edition</option>
              <option value="CATEGORY">Category</option>
            </select>
            <label style={label}>Code (short, e.g. MIFB27 — can't be changed later)</label>
            <input style={inputStyle} value={eventForm.code} onChange={(e) => setEventForm({ ...eventForm, code: e.target.value })} required disabled={!!eventForm.id} />
            <label style={label}>Name</label>
            <input style={inputStyle} value={eventForm.name} onChange={(e) => setEventForm({ ...eventForm, name: e.target.value })} required />
            {eventForm.tier !== 'MAIN' && (
              <>
                <label style={label}>Year</label>
                <input type="number" style={inputStyle} value={eventForm.event_year} onChange={(e) => setEventForm({ ...eventForm, event_year: e.target.value })} />
                <label style={label}>Start Date</label>
                <input type="date" style={inputStyle} value={eventForm.start_date} onChange={(e) => setEventForm({ ...eventForm, start_date: e.target.value })} />
                <label style={label}>End Date</label>
                <input type="date" style={inputStyle} value={eventForm.end_date} onChange={(e) => setEventForm({ ...eventForm, end_date: e.target.value })} />
              </>
            )}
            {eventForm.tier === 'EDITION' && (
              <>
                <label style={label}>Venue</label>
                <input style={inputStyle} value={eventForm.venue} onChange={(e) => setEventForm({ ...eventForm, venue: e.target.value })} />
                <label style={label}>Main event (optional)</label>
                <select style={inputStyle} value={eventForm.parent_event_id} onChange={(e) => setEventForm({ ...eventForm, parent_event_id: e.target.value })}>
                  <option value="">— Standalone, no Main —</option>
                  {events.filter((ev) => ev.tier === 'MAIN').map((ev) => (
                    <option key={ev.id} value={ev.id}>{ev.name}</option>
                  ))}
                </select>
              </>
            )}
            {eventForm.tier === 'CATEGORY' && (
              <>
                <label style={label}>Edition</label>
                <select style={inputStyle} value={eventForm.parent_event_id} onChange={(e) => setEventForm({ ...eventForm, parent_event_id: e.target.value })} required>
                  <option value="">— Select —</option>
                  {events.filter((ev) => ev.tier === 'EDITION').map((ev) => (
                    <option key={ev.id} value={ev.id}>{ev.name}</option>
                  ))}
                </select>
              </>
            )}
            <button type="submit" style={{ padding: '8px 16px', marginTop: 16 }}>
              {eventForm.id ? 'Save Changes' : 'Create Event'}
            </button>
          </form>
        )}

        <table width="100%" cellPadding="6">
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
              <th>Code</th>
              <th>Name</th>
              <th>Year</th>
              <th>Venue</th>
              <th>Type</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {[
              ...events.filter((ev) => ev.tier === 'MAIN').flatMap((main) => [
                main,
                ...events.filter((ed) => ed.tier === 'EDITION' && ed.parent_event_id === main.id).flatMap((ed) => [
                  ed,
                  ...events.filter((cat) => cat.tier === 'CATEGORY' && cat.parent_event_id === ed.id),
                ]),
              ]),
              ...events.filter((ed) => ed.tier === 'EDITION' && !ed.parent_event_id).flatMap((ed) => [
                ed,
                ...events.filter((cat) => cat.tier === 'CATEGORY' && cat.parent_event_id === ed.id),
              ]),
            ].map((ev) => (
              <tr key={ev.id} style={{ borderBottom: '1px solid #eee', opacity: ev.is_active ? 1 : 0.5 }}>
                <td style={ev.tier === 'MAIN' ? { fontWeight: 600 } : { paddingLeft: ev.tier === 'CATEGORY' ? 40 : 20 }}>
                  {ev.tier !== 'MAIN' ? '↳ ' : ''}{ev.code}
                </td>
                <td>{ev.name}</td>
                <td>{ev.event_year || '—'}</td>
                <td>{ev.venue || '—'}</td>
                <td>
                  {ev.tier === 'MAIN' ? 'Main' : ev.tier === 'EDITION' ? (ev.parent_code ? `Edition of ${ev.parent_code}` : 'Edition (standalone)') : `Category of ${ev.parent_code}`}
                </td>
                <td>{ev.is_active ? 'Active' : 'Inactive'}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {ev.tier === 'MAIN' && (
                    ev.has_logo ? (
                      <button onClick={() => handleDeleteEventLogo(ev)} style={{ fontSize: 12, padding: '3px 8px', marginRight: 6 }}>Remove Logo</button>
                    ) : (
                      <label style={{ fontSize: 12, padding: '3px 8px', border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer', marginRight: 6, display: 'inline-block' }}>
                        Upload Logo
                        <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => e.target.files[0] && handleUploadEventLogo(ev, e.target.files[0])} />
                      </label>
                    )
                  )}
                  <button onClick={() => startEditEvent(ev)}>Edit</button>{' '}
                  <button onClick={() => handleToggleEventActive(ev)}>{ev.is_active ? 'Deactivate' : 'Activate'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontSize: 12, color: '#5c6070' }}>
          The event dropdown in the top bar picks up event changes on the next page reload.
        </p>
      </div>
      )}

      {activeTab === 'exchange-rate' && (
      <div style={section}>
        <h3>Exchange Rate</h3>
        <p style={{ fontSize: 13, color: '#5c6070' }}>
          Default USD:MYR estimate used for contracts that aren't invoiced yet (pipeline valuation only).
          Once Finance generates an invoice, they enter the actual rate for that specific invoice — this
          default has no effect on invoiced amounts.
        </p>
        <form onSubmit={handleSaveExchangeRate} style={{ display: 'flex', gap: 8, alignItems: 'center', maxWidth: 300 }}>
          <span>1 USD =</span>
          <input
            type="number" step="0.0001" style={{ ...inputStyle, width: 120 }}
            value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} required
          />
          <span>MYR</span>
          <button type="submit" disabled={savingRate}>{savingRate ? 'Saving...' : 'Save'}</button>
        </form>
      </div>
      )}

      {activeTab === 'company-profile' && (
      <div style={section}>
        <h3>Company Profile (Invoice Letterhead)</h3>
        <p style={{ fontSize: 13, color: '#5c6070' }}>
          Registration/tax numbers, address and bank details printed on every contract, invoice and receipt.
        </p>

        <h4 style={{ marginBottom: 4 }}>Branding</h4>
        <p style={{ fontSize: 12, color: '#5c6070', marginTop: 0 }}>
          Your own logo and letterhead — replaces ExpoCO's on every Contract, Proforma, Invoice, Receipt and
          Statement this company generates. PNG/JPG, up to 3MB each.
        </p>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
          {[
            { type: 'logo', label: 'Logo', hint: 'Square-ish, shown top-left of documents' },
            { type: 'letterhead', label: 'Letterhead Header', hint: 'Wide strip across the top' },
            { type: 'footer', label: 'Footer', hint: 'Wide strip across the bottom' },
            { type: 'event_logo', label: 'Event/Brand Logo', hint: 'Your event’s own brand (e.g. MIFB), shown alongside the company logo on Contracts' },
            {
              type: 'contract_terms_pdf', label: 'Terms & Conditions (PDF)', isPdf: true,
              hint: 'Your own formatted T&C document — auto-appended as trailing pages on every Contract PDF, replacing the plain-text version below',
            },
          ].map(({ type, label, hint, isPdf }) => (
            <div key={type} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, width: 220 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 11, color: '#5c6070', marginBottom: 8 }}>{hint}</div>
              <div style={{
                height: 70, background: '#f5f6fa', border: '1px dashed #ccc', borderRadius: 6,
                display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8, overflow: 'hidden',
              }}>
                {branding[type] ? (
                  isPdf ? (
                    <span style={{ fontSize: 12, color: '#2b8a3e' }}>✓ PDF uploaded</span>
                  ) : (
                    <img
                      src={`${api.brandingImageUrl(type)}?v=${brandingBust}`}
                      alt={label}
                      style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }}
                    />
                  )
                ) : (
                  <span style={{ fontSize: 11, color: '#aaa' }}>Not uploaded</span>
                )}
              </div>
              <label style={{ display: 'inline-block', fontSize: 12, cursor: 'pointer' }}>
                {brandingUploading === type ? 'Uploading...' : (branding[type] ? 'Replace' : 'Upload')}
                <input
                  type="file" accept={isPdf ? 'application/pdf' : 'image/*'} style={{ display: 'none' }}
                  onChange={(e) => handleUploadBranding(type, e.target.files[0])}
                  disabled={brandingUploading === type}
                />
              </label>
              {branding[type] && (
                <button type="button" onClick={() => handleDeleteBranding(type)} style={{ fontSize: 12, marginLeft: 8 }}>
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>

        <form onSubmit={handleSaveProfile} style={{ maxWidth: 500 }}>
          <label style={label}>Event/Brand Name</label>
          <p style={{ fontSize: 12, color: '#5c6070', marginTop: 0 }}>
            Shown next to the Event/Brand Logo above on Contracts — leave blank to just use the event's own name
            (e.g. "MIFB 2026") as set up under Events.
          </p>
          <input style={inputStyle} value={profileForm.event_name} onChange={(e) => setProfileForm({ ...profileForm, event_name: e.target.value })} />

          <label style={label}>Registration No.</label>
          <input style={inputStyle} value={profileForm.reg_no} onChange={(e) => setProfileForm({ ...profileForm, reg_no: e.target.value })} />
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={label}>TIN No.</label>
              <input style={inputStyle} value={profileForm.tin_no} onChange={(e) => setProfileForm({ ...profileForm, tin_no: e.target.value })} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={label}>SST No.</label>
              <input style={inputStyle} value={profileForm.sst_no} onChange={(e) => setProfileForm({ ...profileForm, sst_no: e.target.value })} />
            </div>
          </div>
          <label style={label}>Address</label>
          <textarea style={{ ...inputStyle, minHeight: 56 }} value={profileForm.address} onChange={(e) => setProfileForm({ ...profileForm, address: e.target.value })} />
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={label}>Phone</label>
              <input style={inputStyle} value={profileForm.phone} onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={label}>Email</label>
              <input style={inputStyle} value={profileForm.email} onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })} />
            </div>
          </div>
          <label style={label}>Bank Name</label>
          <input style={inputStyle} value={profileForm.bank_name} onChange={(e) => setProfileForm({ ...profileForm, bank_name: e.target.value })} />
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={label}>Bank Account No.</label>
              <input style={inputStyle} value={profileForm.bank_account_no} onChange={(e) => setProfileForm({ ...profileForm, bank_account_no: e.target.value })} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={label}>SWIFT Code</label>
              <input style={inputStyle} value={profileForm.bank_swift} onChange={(e) => setProfileForm({ ...profileForm, bank_swift: e.target.value })} />
            </div>
          </div>
          <label style={label}>Payment Instructions (any extra notes printed under bank details)</label>
          <textarea style={{ ...inputStyle, minHeight: 56 }} value={profileForm.payment_instructions} onChange={(e) => setProfileForm({ ...profileForm, payment_instructions: e.target.value })} />

          <h4 style={{ marginBottom: 4, marginTop: 24 }}>Contract Terms &amp; Conditions (plain-text fallback)</h4>
          <p style={{ fontSize: 12, color: '#5c6070', marginTop: 0 }}>
            {branding.contract_terms_pdf
              ? 'A Terms & Conditions PDF is uploaded above and takes priority — it is appended to every Contract instead of this text. Remove it above to fall back to this text.'
              : 'Printed as its own page at the end of every Contract. Leave blank to omit it entirely — nothing is hardcoded, each company sets its own wording here. Upload a formatted PDF above instead if you have one.'}
          </p>
          <textarea
            style={{ ...inputStyle, minHeight: 200, fontFamily: 'monospace', fontSize: 12 }}
            value={profileForm.contract_terms}
            onChange={(e) => setProfileForm({ ...profileForm, contract_terms: e.target.value })}
          />

          <h4 style={{ marginBottom: 4, marginTop: 24 }}>Group Resource Sharing</h4>
          {!groupInfo?.group_id ? (
            <p style={{ fontSize: 12, color: '#5c6070', marginTop: 0 }}>
              This company doesn&rsquo;t belong to a group, so there is nothing to share with.
            </p>
          ) : (
            <>
              <p style={{ fontSize: 12, color: '#5c6070', marginTop: 0 }}>
                Part of <strong>{groupInfo.group_name}</strong>
                {Number(groupInfo.peer_count) > 0
                  ? ` with ${groupInfo.peer_count} other compan${Number(groupInfo.peer_count) === 1 ? 'y' : 'ies'}.`
                  : ' (no other companies in it yet).'}
                {' '}When on, those companies can see your exhibitors <strong>in search results only</strong> — company
                name, country, which of your salespeople handles them, and which events. They cannot open the record,
                see contact details, or use it in their own quotes or invoices.
                {' '}Sharing is <strong>mutual</strong>: you only see theirs while you are sharing yours.
                Off by default.
              </p>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 8 }}>
                <input
                  type="checkbox"
                  checked={!!sharing.EXHIBITORS}
                  disabled={savingSharing === 'EXHIBITORS'}
                  onChange={async (e) => {
                    const next = e.target.checked;
                    setSavingSharing('EXHIBITORS');
                    setError('');
                    try {
                      await api.updateGroupSharing('EXHIBITORS', next);
                      setSharing((s) => ({ ...s, EXHIBITORS: next }));
                    } catch (err) {
                      setError(err.message);
                    } finally {
                      setSavingSharing('');
                    }
                  }}
                />
                Share my Exhibitor list with the rest of {groupInfo.group_name} (search visibility only)
              </label>
            </>
          )}

          <h4 style={{ marginBottom: 4, marginTop: 24 }}>Stamp Duty</h4>
          <p style={{ fontSize: 12, color: '#5c6070', marginTop: 0 }}>
            Off by default. When on, Sales can optionally add a Stamp Duty line to an Opportunity/Contract's billing —
            computed as a % of the contract's total value (before tax), rounded up/down to the nearest amount below,
            with a minimum charge. <strong>The default rate/rounding/minimum below are a starting point, not verified
            against LHDN</strong> — confirm the correct figures for your own jurisdiction before relying on this for a
            real invoice.
          </p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 8 }}>
            <input
              type="checkbox"
              checked={profileForm.stamp_duty_enabled}
              onChange={(e) => setProfileForm({ ...profileForm, stamp_duty_enabled: e.target.checked })}
            />
            Enable Stamp Duty for this company
          </label>
          {profileForm.stamp_duty_enabled && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 140px' }}>
                <label style={label}>Rate (%)</label>
                <input
                  type="number" step="0.01" min="0" style={inputStyle}
                  value={profileForm.stamp_duty_rate_pct}
                  onChange={(e) => setProfileForm({ ...profileForm, stamp_duty_rate_pct: e.target.value })}
                />
              </div>
              <div style={{ flex: '1 1 140px' }}>
                <label style={label}>Round to nearest (RM)</label>
                <input
                  type="number" step="0.01" min="0" style={inputStyle}
                  value={profileForm.stamp_duty_round_to}
                  onChange={(e) => setProfileForm({ ...profileForm, stamp_duty_round_to: e.target.value })}
                />
              </div>
              <div style={{ flex: '1 1 140px' }}>
                <label style={label}>Minimum charge (RM)</label>
                <input
                  type="number" step="0.01" min="0" style={inputStyle}
                  value={profileForm.stamp_duty_minimum}
                  onChange={(e) => setProfileForm({ ...profileForm, stamp_duty_minimum: e.target.value })}
                />
              </div>
            </div>
          )}

          <button type="submit" disabled={savingProfile} style={{ marginTop: 12 }}>{savingProfile ? 'Saving...' : 'Save Profile'}</button>
        </form>
      </div>
      )}

      {activeTab === 'tax-codes' && (
      <div style={section}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>Tax Codes</h3>
          <button onClick={() => { setTaxCodeForm(emptyTaxCodeForm); setShowTaxCodeForm(!showTaxCodeForm); }}>
            {showTaxCodeForm ? 'Cancel' : '+ Add Tax Code'}
          </button>
        </div>

        {showTaxCodeForm && (
          <form onSubmit={handleSaveTaxCode} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <label style={label}>Code (e.g. SV-6)</label>
            <input style={inputStyle} value={taxCodeForm.code} onChange={(e) => setTaxCodeForm({ ...taxCodeForm, code: e.target.value })} required disabled={!!taxCodeForm.id} />
            <label style={label}>Name</label>
            <input style={inputStyle} value={taxCodeForm.name} onChange={(e) => setTaxCodeForm({ ...taxCodeForm, name: e.target.value })} required />
            <label style={label}>Rate (%)</label>
            <input type="number" step="0.01" style={inputStyle} value={taxCodeForm.rate_pct} onChange={(e) => setTaxCodeForm({ ...taxCodeForm, rate_pct: e.target.value })} required />
            <button type="submit" style={{ padding: '8px 16px', marginTop: 16 }}>{taxCodeForm.id ? 'Save Changes' : 'Add Tax Code'}</button>
          </form>
        )}

        <table width="100%" cellPadding="6">
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
              <th>Code</th><th>Name</th><th>Rate</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {taxCodes.map((tc) => (
              <tr key={tc.id} style={{ borderBottom: '1px solid #eee', opacity: tc.is_active ? 1 : 0.5 }}>
                <td>{tc.code}</td>
                <td>{tc.name}</td>
                <td>{tc.rate_pct}%</td>
                <td>{tc.is_active ? 'Active' : 'Inactive'}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button onClick={() => { setTaxCodeForm({ id: tc.id, code: tc.code, name: tc.name, rate_pct: tc.rate_pct }); setShowTaxCodeForm(true); }}>Edit</button>{' '}
                  <button onClick={() => handleToggleTaxCodeActive(tc)}>{tc.is_active ? 'Deactivate' : 'Activate'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {activeTab === 'expense-codes' && (
      <div style={section}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>Expense Codes</h3>
          <button onClick={() => { setExpenseCodeForm(emptyExpenseCodeForm); setShowExpenseCodeForm(!showExpenseCodeForm); }}>
            {showExpenseCodeForm ? 'Cancel' : '+ Add Expense Code'}
          </button>
        </div>
        <p style={{ fontSize: 13, color: '#5c6070' }}>
          The GL/expense code reference list used by the Budget module — both for Budget Expense lines and for
          coding actual expense entries as they're logged.
        </p>

        {showExpenseCodeForm && (
          <form onSubmit={handleSaveExpenseCode} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <label style={label}>Code</label>
            <input style={inputStyle} value={expenseCodeForm.code} onChange={(e) => setExpenseCodeForm({ ...expenseCodeForm, code: e.target.value })} required disabled={!!expenseCodeForm.id} />
            <label style={label}>Description</label>
            <input style={inputStyle} value={expenseCodeForm.description} onChange={(e) => setExpenseCodeForm({ ...expenseCodeForm, description: e.target.value })} required />
            <label style={label}>Type</label>
            <select style={inputStyle} value={expenseCodeForm.type} onChange={(e) => setExpenseCodeForm({ ...expenseCodeForm, type: e.target.value })}>
              <option value="EXPENSE">Expense</option>
              <option value="REVENUE">Revenue</option>
            </select>
            <button type="submit" style={{ padding: '8px 16px', marginTop: 16 }}>{expenseCodeForm.id ? 'Save Changes' : 'Add Expense Code'}</button>
          </form>
        )}

        <table width="100%" cellPadding="6">
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
              <th>Code</th><th>Description</th><th>Type</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {expenseCodes.map((ec) => (
              <tr key={ec.id} style={{ borderBottom: '1px solid #eee', opacity: ec.is_active ? 1 : 0.5 }}>
                <td>{ec.code}</td>
                <td>{ec.description}</td>
                <td>{ec.type === 'REVENUE' ? 'Revenue' : 'Expense'}</td>
                <td>{ec.is_active ? 'Active' : 'Inactive'}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button onClick={() => { setExpenseCodeForm({ id: ec.id, code: ec.code, description: ec.description, type: ec.type || 'EXPENSE' }); setShowExpenseCodeForm(true); }}>Edit</button>{' '}
                  <button onClick={() => handleToggleExpenseCodeActive(ec)}>{ec.is_active ? 'Deactivate' : 'Activate'}</button>
                </td>
              </tr>
            ))}
            {expenseCodes.length === 0 && <tr><td colSpan={5} style={{ fontSize: 13, color: '#5c6070' }}>None set up yet.</td></tr>}
          </tbody>
        </table>
      </div>
      )}

      {activeTab === 'segments' && (
      <div style={section}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>Segments</h3>
        </div>
        <p style={{ fontSize: 13, color: '#5c6070' }}>
          The Segment / Sub-Segment field on an Exhibitor's record — company-configurable, not a fixed list.
          Bulk add/update via Excel is under Admin &gt; Data Import.
        </p>

        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 16 }}>
          <div style={{ flex: '1 1 320px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h4 style={{ margin: 0 }}>Main Segments</h4>
              <button type="button" onClick={() => { setSegMainForm({ id: '', code: '', name: '' }); setShowSegMainForm(!showSegMainForm); }}>
                {showSegMainForm ? 'Cancel' : '+ Add'}
              </button>
            </div>
            {showSegMainForm && (
              <form onSubmit={handleSaveSegMain} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, margin: '12px 0' }}>
                <label style={label}>Code</label>
                <input style={inputStyle} value={segMainForm.code} onChange={(e) => setSegMainForm({ ...segMainForm, code: e.target.value })} required />
                <label style={label}>Name</label>
                <input style={inputStyle} value={segMainForm.name} onChange={(e) => setSegMainForm({ ...segMainForm, name: e.target.value })} required />
                <button type="submit" style={{ padding: '8px 16px', marginTop: 16 }}>{segMainForm.id ? 'Save Changes' : 'Add'}</button>
              </form>
            )}
            {segments === null ? (
              <p>Loading...</p>
            ) : (
              <table width="100%" cellPadding="6">
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                    <th>Code</th><th>Name</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {segments.map((m) => (
                    <tr key={m.id} style={{ borderBottom: '1px solid #eee' }}>
                      <td>{m.code}</td>
                      <td>{m.name}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button onClick={() => { setSegMainForm({ id: m.id, code: m.code, name: m.name }); setShowSegMainForm(true); }}>Edit</button>{' '}
                        <button onClick={() => handleDeleteSegMain(m)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                  {segments.length === 0 && <tr><td colSpan={3} style={{ fontSize: 13, color: '#5c6070' }}>None set up yet.</td></tr>}
                </tbody>
              </table>
            )}
          </div>

          <div style={{ flex: '1 1 320px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h4 style={{ margin: 0 }}>Sub-Segments</h4>
              <button
                type="button"
                disabled={!segments || segments.length === 0}
                onClick={() => { setSegSubForm({ id: '', segment_main_id: segments?.[0]?.id || '', code: '', name: '' }); setShowSegSubForm(!showSegSubForm); }}
              >
                {showSegSubForm ? 'Cancel' : '+ Add'}
              </button>
            </div>
            {showSegSubForm && (
              <form onSubmit={handleSaveSegSub} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, margin: '12px 0' }}>
                <label style={label}>Main Segment</label>
                <select
                  style={inputStyle} value={segSubForm.segment_main_id}
                  onChange={(e) => setSegSubForm({ ...segSubForm, segment_main_id: e.target.value })}
                  disabled={!!segSubForm.id} required
                >
                  {(segments || []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <label style={label}>Code</label>
                <input style={inputStyle} value={segSubForm.code} onChange={(e) => setSegSubForm({ ...segSubForm, code: e.target.value })} required />
                <label style={label}>Name</label>
                <input style={inputStyle} value={segSubForm.name} onChange={(e) => setSegSubForm({ ...segSubForm, name: e.target.value })} required />
                <button type="submit" style={{ padding: '8px 16px', marginTop: 16 }}>{segSubForm.id ? 'Save Changes' : 'Add'}</button>
              </form>
            )}
            {segments !== null && (
              <table width="100%" cellPadding="6">
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                    <th>Main</th><th>Code</th><th>Name</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {segments.flatMap((m) => m.subSegments.map((s) => (
                    <tr key={s.id} style={{ borderBottom: '1px solid #eee' }}>
                      <td>{m.name}</td>
                      <td>{s.code}</td>
                      <td>{s.name}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button onClick={() => { setSegSubForm({ id: s.id, segment_main_id: m.id, code: s.code, name: s.name }); setShowSegSubForm(true); }}>Edit</button>{' '}
                        <button onClick={() => handleDeleteSegSub(s)}>Delete</button>
                      </td>
                    </tr>
                  )))}
                  {segments.every((m) => m.subSegments.length === 0) && (
                    <tr><td colSpan={4} style={{ fontSize: 13, color: '#5c6070' }}>None set up yet.</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
      )}

      {activeTab === 'data-import' && (
      <div style={section}>
        <h3>Data Import</h3>
        <p style={{ fontSize: 13, color: '#5c6070' }}>
          Bulk add/update from Excel — every import here is safe to re-run: a row that matches an existing record
          updates it in place, a new one gets created. Nothing is ever deleted or overwritten destructively.
        </p>

        <div style={{ marginTop: 24, paddingTop: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h4 style={{ margin: 0 }}>Exhibitors — New / Bulk Import</h4>
            <div>
              <button type="button" onClick={handleDownloadExhibitorTemplate} style={{ marginRight: 8 }}>Download Template</button>
              <label style={{ padding: '8px 16px', border: '1px solid #ccc', borderRadius: 6, cursor: 'pointer', display: 'inline-block' }}>
                {exhibitorImporting ? 'Uploading...' : 'Upload Template'}
                <input type="file" accept=".xlsx,.xls,.csv" onChange={handleUploadExhibitorFile} disabled={exhibitorImporting} style={{ display: 'none' }} />
              </label>
            </div>
          </div>
          <p style={{ fontSize: 13, color: '#5c6070' }}>
            Matched by Company Name — for batch-loading potential exhibitors from a directory list. Only Company
            Name is required; everything else (address, contacts, etc.) can be filled in later once the lead is
            actually contacted. Salesperson Email and Agent Name are optional lookups against your existing users
            and agents.
          </p>
          {exhibitorImportResult && (
            <p style={{ fontSize: 13, color: '#2a7a2a' }}>
              Import complete: {exhibitorImportResult.created} created, {exhibitorImportResult.updated} updated,
              {' '}{exhibitorImportResult.rowsProcessed} row(s) processed.
              {exhibitorImportResult.skipped.length > 0 && (
                <> {exhibitorImportResult.skipped.join(' ')}</>
              )}
            </p>
          )}
        </div>

        <div style={{ marginTop: 24, borderTop: '1px solid #eee', paddingTop: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h4 style={{ margin: 0 }}>Exhibitors — Repeat Flag</h4>
            <div>
              <button type="button" onClick={handleDownloadRepeatTemplate} style={{ marginRight: 8 }}>Download Template</button>
              <label style={{ padding: '8px 16px', border: '1px solid #ccc', borderRadius: 6, cursor: 'pointer', display: 'inline-block' }}>
                {repeatImporting ? 'Uploading...' : 'Upload Template'}
                <input type="file" accept=".xlsx,.xls,.csv" onChange={handleUploadRepeatFile} disabled={repeatImporting} style={{ display: 'none' }} />
              </label>
            </div>
          </div>
          <p style={{ fontSize: 13, color: '#5c6070' }}>
            Feeds the Agent Commission report's repeat-vs-new rate split (Reports &gt; Agent Commission). List last
            year's exhibiting companies (one per row); any current exhibitor whose company name matches gets flagged
            "Repeat Exhibitor" automatically. A missed match (e.g. a renamed company) can be corrected by hand on
            that Exhibitor's own record.
          </p>
          {repeatImportResult && (
            <p style={{ fontSize: 13, color: '#2a7a2a' }}>
              Import complete: {repeatImportResult.matched} of {repeatImportResult.namesInFile} name(s) matched and flagged repeat.
              {repeatImportResult.unmatched.length > 0 && (
                <> Not matched: {repeatImportResult.unmatched.join(', ')}.</>
              )}
            </p>
          )}
        </div>

        <div style={{ marginTop: 24, borderTop: '1px solid #eee', paddingTop: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h4 style={{ margin: 0 }}>Agents</h4>
            <div>
              <button type="button" onClick={handleDownloadAgentTemplate} style={{ marginRight: 8 }}>Download Template</button>
              <label style={{ padding: '8px 16px', border: '1px solid #ccc', borderRadius: 6, cursor: 'pointer', display: 'inline-block' }}>
                {agentImporting ? 'Uploading...' : 'Upload Template'}
                <input type="file" accept=".xlsx,.xls,.csv" onChange={handleUploadAgentFile} disabled={agentImporting} style={{ display: 'none' }} />
              </label>
            </div>
          </div>
          <p style={{ fontSize: 13, color: '#5c6070' }}>
            Matched by Agent Name. Salesperson Email is optional — leave blank to assign the owning salesperson
            later on the Sales Agent record itself.
          </p>
          {agentImportResult && (
            <p style={{ fontSize: 13, color: '#2a7a2a' }}>
              Import complete: {agentImportResult.created} created, {agentImportResult.updated} updated,
              {' '}{agentImportResult.rowsProcessed} row(s) processed.
              {agentImportResult.skipped.length > 0 && (
                <> {agentImportResult.skipped.join(' ')}</>
              )}
            </p>
          )}
        </div>

        <div style={{ marginTop: 24, borderTop: '1px solid #eee', paddingTop: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h4 style={{ margin: 0 }}>Expense Codes</h4>
            <div>
              <button type="button" onClick={handleDownloadExpenseCodeTemplate} style={{ marginRight: 8 }}>Download Template</button>
              <label style={{ padding: '8px 16px', border: '1px solid #ccc', borderRadius: 6, cursor: 'pointer', display: 'inline-block' }}>
                {expenseCodeImporting ? 'Uploading...' : 'Upload Template'}
                <input type="file" accept=".xlsx,.xls,.csv" onChange={handleUploadExpenseCodeFile} disabled={expenseCodeImporting} style={{ display: 'none' }} />
              </label>
            </div>
          </div>
          <p style={{ fontSize: 13, color: '#5c6070' }}>
            Matched by Code — the Budget module's GL/expense reference list. Type must be EXPENSE or REVENUE.
          </p>
          {expenseCodeImportResult && (
            <p style={{ fontSize: 13, color: expenseCodeImportResult.errors.length > 0 ? '#b45309' : '#2a7a2a' }}>
              Import complete: {expenseCodeImportResult.created} created, {expenseCodeImportResult.updated} updated,
              {' '}{expenseCodeImportResult.rowsProcessed} row(s) processed.
              {expenseCodeImportResult.errors.length > 0 && (
                <> Errors: {expenseCodeImportResult.errors.join('; ')}</>
              )}
            </p>
          )}
        </div>

        <div style={{ marginTop: 24, borderTop: '1px solid #eee', paddingTop: 24 }}>
          <h4 style={{ margin: 0 }}>Segments</h4>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <p style={{ fontSize: 13, color: '#5c6070', margin: 0, flex: 1 }}>
              Main/Sub-segment pairs for the Exhibitor Segment field. Leave Sub Code/Name blank for a Main-only
              segment. Manage the list itself under Admin &gt; Segments.
            </p>
            <div style={{ whiteSpace: 'nowrap', marginLeft: 12 }}>
              <button type="button" onClick={handleDownloadSegmentTemplate} style={{ marginRight: 8 }}>Download Template</button>
              <label style={{ padding: '8px 16px', border: '1px solid #ccc', borderRadius: 6, cursor: 'pointer', display: 'inline-block' }}>
                {segImporting ? 'Uploading...' : 'Upload Template'}
                <input type="file" accept=".xlsx,.xls,.csv" onChange={handleUploadSegmentFile} disabled={segImporting} style={{ display: 'none' }} />
              </label>
            </div>
          </div>
          {segImportResult && (
            <p style={{ fontSize: 13, color: '#2a7a2a' }}>
              Import complete: {segImportResult.mainsCreated} main segment(s) and {segImportResult.subsCreated} sub-segment(s)
              created, {segImportResult.rowsProcessed} row(s) processed.
            </p>
          )}
        </div>

        <div style={{ marginTop: 24, borderTop: '1px solid #eee', paddingTop: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h4 style={{ margin: 0 }}>Users</h4>
            <div>
              <button type="button" onClick={handleDownloadUserTemplate} style={{ marginRight: 8 }}>Download Template</button>
              <label style={{ padding: '8px 16px', border: '1px solid #ccc', borderRadius: 6, cursor: 'pointer', display: 'inline-block' }}>
                {userImporting ? 'Uploading...' : 'Upload Template'}
                <input type="file" accept=".xlsx,.xls,.csv" onChange={handleUploadUserFile} disabled={userImporting} style={{ display: 'none' }} />
              </label>
            </div>
          </div>
          <p style={{ fontSize: 13, color: '#5c6070' }}>
            Add-only — an email that already exists is skipped, never overwritten (so a bad row can't reset
            someone's password). Role Code must match one of: {roles.map((r) => r.code).join(', ') || '(load Departments tab first)'}.
            Every new account gets a freshly generated temporary password.
          </p>
          <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
            <label style={{ fontSize: 13 }}>
              <input type="radio" checked={userImportMode === 'temp_password'} onChange={() => setUserImportMode('temp_password')} />
              {' '}Show temp passwords to copy/hand out myself
            </label>
            <label style={{ fontSize: 13 }}>
              <input type="radio" checked={userImportMode === 'email_invite'} onChange={() => setUserImportMode('email_invite')} />
              {' '}Also let me copy a drafted invite email per user
            </label>
          </div>
          {userImportResult && (
            <>
              <p style={{ fontSize: 13, color: '#2a7a2a' }}>
                Import complete: {userImportResult.created} of {userImportResult.rowsProcessed} row(s) created.
              </p>
              {userImportResult.createdUsers.length > 0 && (
                <table width="100%" cellPadding="6" style={{ fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                      <th>Email</th><th>Full Name</th><th>Role</th><th>Temp Password</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {userImportResult.createdUsers.map((u) => (
                      <tr key={u.id} style={{ borderBottom: '1px solid #eee' }}>
                        <td>{u.email}</td>
                        <td>{u.full_name}</td>
                        <td>{u.role_code}</td>
                        <td style={{ fontFamily: 'monospace' }}>{u.temp_password}</td>
                        <td>
                          {userImportMode === 'email_invite' && (
                            <>
                              <button type="button" onClick={() => copyUserInvite(u)} style={{ marginRight: 6 }}>Copy Invite Email</button>
                              <button type="button" disabled={invitingEmail === u.email} onClick={() => sendUserInvite(u)}>
                                {invitingEmail === u.email ? 'Sending...' : 'Send Invite Email'}
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {userImportResult.skipped.length > 0 && (
                <p style={{ fontSize: 13, color: '#b45309' }}>
                  Skipped: {userImportResult.skipped.map((s) => `${s.email} (${s.reason})`).join('; ')}
                </p>
              )}
            </>
          )}
        </div>
      </div>
      )}

      {activeTab === 'departments' && (
      <div style={section}>
        <h3>Departments</h3>
        <p style={{ fontSize: 13, color: '#5c6070' }}>
          Your company's own divisions/departments — not a fixed list. Every new department starts with no special
          module permissions (same baseline access as any regular user) until you grant it View, View + Add, or
          Full Edit per module below. "View + Add" means the department can log brand-new records but can't
          edit or overwrite ones already saved — useful for a data-entry-only role. This only covers the modules
          listed below; anything else (Admin, Budget, Floor Plan, approvals, etc.) keeps working exactly as it does
          today regardless of what's set here.
        </p>

        <form onSubmit={handleCreateRole} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 20, flexWrap: 'wrap' }}>
          <div>
            <label style={label}>New Department Code</label>
            <input style={inputStyle} placeholder="e.g. MARKETING" value={newRoleForm.code} onChange={(e) => setNewRoleForm({ ...newRoleForm, code: e.target.value })} required />
          </div>
          <div>
            <label style={label}>Name</label>
            <input style={inputStyle} placeholder="e.g. Marketing" value={newRoleForm.name} onChange={(e) => setNewRoleForm({ ...newRoleForm, name: e.target.value })} required />
          </div>
          <button type="submit" disabled={roleBusy}>+ Add Department</button>
        </form>

        <table width="100%" cellPadding="6">
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
              <th>Code</th><th>Name</th><th>Module Permissions</th><th></th>
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => (
              <>
                <tr key={r.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td>{r.code}</td>
                  <td>{r.name}</td>
                  <td style={{ fontSize: 12, color: '#5c6070' }}>
                    {Object.keys(r.permissions || {}).length === 0
                      ? '— (default access)'
                      : Object.entries(r.permissions).map(([m, lvl]) => `${m}: ${PERMISSION_LEVEL_LABELS[lvl] || lvl}`).join(', ')}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button type="button" onClick={() => (editingRoleId === r.id ? setEditingRoleId(null) : openRoleEditor(r))}>
                      {editingRoleId === r.id ? 'Close' : 'Edit'}
                    </button>{' '}
                    <button type="button" onClick={() => handleDeleteRole(r)}>Delete</button>
                  </td>
                </tr>
                {editingRoleId === r.id && (
                  <tr>
                    <td colSpan={4} style={{ background: '#F5F6FA', padding: 12 }}>
                      <label style={label}>Name</label>
                      <input style={{ ...inputStyle, maxWidth: 300 }} value={roleEditForm.name} onChange={(e) => setRoleEditForm({ ...roleEditForm, name: e.target.value })} />
                      <table style={{ marginTop: 12 }} cellPadding="6">
                        <thead>
                          <tr style={{ textAlign: 'left' }}>
                            <th>Module</th><th>Access Level</th>
                          </tr>
                        </thead>
                        <tbody>
                          {PERMISSION_MODULES.map((m) => (
                            <tr key={m.key}>
                              <td>{m.label}</td>
                              <td>
                                <select
                                  style={{ ...inputStyle, width: 220 }}
                                  value={roleEditForm.permissions[m.key] || ''}
                                  onChange={(e) => setRolePermission(m.key, e.target.value)}
                                >
                                  <option value="">Default access (not managed here)</option>
                                  <option value="view">View only</option>
                                  <option value="add">View + Add (no edit)</option>
                                  <option value="edit">Full edit</option>
                                </select>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <button type="button" onClick={handleSaveRole} disabled={roleBusy} style={{ marginTop: 12 }}>
                        {roleBusy ? 'Saving...' : 'Save Department'}
                      </button>
                    </td>
                  </tr>
                )}
              </>
            ))}
            {roles.length === 0 && <tr><td colSpan={4} style={{ fontSize: 13, color: '#5c6070' }}>None set up yet.</td></tr>}
          </tbody>
        </table>
      </div>
      )}

      {activeTab === 'approval-rules' && (
      <div style={section}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>Approval Rules</h3>
          <button onClick={() => { setRuleForm(emptyRuleForm); setShowRuleForm(!showRuleForm); }}>
            {showRuleForm ? 'Cancel' : '+ Add Rule'}
          </button>
        </div>
        <p style={{ fontSize: 13, color: '#5c6070' }}>
          Every new contract starts as a Draft and needs an explicit "Send for Approval" before Admin/Management
          can approve it — that part isn't optional. Rules below are extra triggers on top of that. Pick a
          trigger in "+ Add Rule" to see what it does — the explanation appears there, not as a fixed block on
          this page.
        </p>

        {showRuleForm && (
          <form onSubmit={handleSaveRule} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <label style={label}>Trigger</label>
            <select
              style={inputStyle} value={ruleForm.trigger_type} disabled={!!ruleForm.id}
              onChange={(e) => {
                const trigger_type = e.target.value;
                // Revenue/Credit Note thresholds are always a flat RM amount
                // — there's no sensible "percent" reading for a contract's
                // total value, so the type selector only shows for Discount.
                const threshold_type = trigger_type === 'DISCOUNT_ABOVE_THRESHOLD' ? ruleForm.threshold_type || 'PERCENT' : 'FLAT';
                setRuleForm({ ...ruleForm, trigger_type, threshold_type });
              }}
            >
              {SELECTABLE_TRIGGERS.map((k) => (
                <option key={k} value={k}>{TRIGGER_LABELS[k]}</option>
              ))}
            </select>
            {TRIGGER_HELP[ruleForm.trigger_type] && (
              <p style={{ fontSize: 12, color: '#5c6070', background: '#f5f6fa', padding: 8, borderRadius: 6 }}>
                {TRIGGER_HELP[ruleForm.trigger_type]}
              </p>
            )}

            {ruleForm.trigger_type === 'BUDGET_APPROVAL' ? (
              <>
                <label style={label}>Budget Preparer</label>
                <select style={inputStyle} value={profileForm.budget_preparer_user_id} onChange={(e) => setProfileForm({ ...profileForm, budget_preparer_user_id: e.target.value })}>
                  <option value="">— Not set —</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                </select>
                <label style={label}>Budget Approver</label>
                <select style={inputStyle} value={profileForm.budget_approver_user_id} onChange={(e) => setProfileForm({ ...profileForm, budget_approver_user_id: e.target.value })}>
                  <option value="">— Not set —</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                </select>
              </>
            ) : (
              <>
                {ruleForm.trigger_type === 'DISCOUNT_ABOVE_THRESHOLD' && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <label style={label}>Threshold Type</label>
                      <select style={inputStyle} value={ruleForm.threshold_type} onChange={(e) => setRuleForm({ ...ruleForm, threshold_type: e.target.value })}>
                        <option value="PERCENT">Percent (%)</option>
                        <option value="FLAT">Flat amount</option>
                      </select>
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={label}>Threshold Value</label>
                      <input type="number" step="0.01" style={inputStyle} value={ruleForm.threshold_value} onChange={(e) => setRuleForm({ ...ruleForm, threshold_value: e.target.value })} required />
                    </div>
                  </div>
                )}
                {['REVENUE_ABOVE_THRESHOLD', 'CREDIT_NOTE_ISSUED', 'CONTRACT_REDUCTION', 'POST_APPROVAL_EDIT'].includes(ruleForm.trigger_type) && (
                  <div>
                    <label style={label}>Threshold Value (RM)</label>
                    <input type="number" step="0.01" min="0" style={inputStyle} value={ruleForm.threshold_value} onChange={(e) => setRuleForm({ ...ruleForm, threshold_value: e.target.value })} required />
                  </div>
                )}
                <label style={label}>Approver</label>
                <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
                  <label style={{ fontWeight: 400 }}>
                    <input type="radio" name="approver_type" checked={ruleForm.approver_type === 'ROLE'} onChange={() => setRuleForm({ ...ruleForm, approver_type: 'ROLE' })} /> By role
                  </label>
                  <label style={{ fontWeight: 400 }}>
                    <input type="radio" name="approver_type" checked={ruleForm.approver_type === 'PERSON'} onChange={() => setRuleForm({ ...ruleForm, approver_type: 'PERSON' })} /> By specific person
                  </label>
                </div>
                {ruleForm.approver_type === 'ROLE' ? (
                  // Every role this company has actually defined, not a
                  // fixed Admin/Management pair — a second company's role
                  // set can look nothing like ExpoCO's (see CLAUDE.md rule
                  // #2), and Invoice Confirm/Credit Note Confirm/Payment
                  // Record specifically need Finance to be selectable here.
                  <select style={inputStyle} value={ruleForm.approver_role_code} onChange={(e) => setRuleForm({ ...ruleForm, approver_role_code: e.target.value })}>
                    {roles.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
                  </select>
                ) : (
                  <select style={inputStyle} value={ruleForm.approver_user_id} onChange={(e) => setRuleForm({ ...ruleForm, approver_user_id: e.target.value })} required>
                    <option value="">— Select —</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                  </select>
                )}

                <label style={label}>Backup Approver (optional)</label>
                <p style={{ fontSize: 12, color: '#5c6070', marginTop: 0 }}>
                  Can also approve/reject at this tier, in addition to the approver above — e.g. covering for them
                  while they're away.
                </p>
                <select style={inputStyle} value={ruleForm.backup_approver_user_id} onChange={(e) => setRuleForm({ ...ruleForm, backup_approver_user_id: e.target.value })}>
                  <option value="">— None —</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                </select>

                <label style={label}>Applies To Event (optional)</label>
                <p style={{ fontSize: 12, color: '#5c6070', marginTop: 0 }}>
                  Leave as "All events" for a company-wide rule, or restrict this specific threshold/approver to one
                  event only.
                </p>
                <select style={inputStyle} value={ruleForm.event_id} onChange={(e) => setRuleForm({ ...ruleForm, event_id: e.target.value })}>
                  <option value="">— All events —</option>
                  {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
                </select>

                <label style={label}>Escalate After (days, optional)</label>
                <p style={{ fontSize: 12, color: '#5c6070', marginTop: 0 }}>
                  If a request has been sitting pending this many days, the person/role below also becomes allowed
                  to act on it (on top of the approver/backup above) — a fallback for a truly stuck request.
                </p>
                <input
                  type="number" min="1" step="1" style={{ ...inputStyle, maxWidth: 120 }}
                  value={ruleForm.escalate_after_days}
                  onChange={(e) => setRuleForm({ ...ruleForm, escalate_after_days: e.target.value })}
                />
                {ruleForm.escalate_after_days && (
                  <>
                    <div style={{ display: 'flex', gap: 16, margin: '8px 0' }}>
                      <label style={{ fontWeight: 400 }}>
                        <input type="radio" name="escalate_to_type" checked={ruleForm.escalate_to_type === 'ROLE'} onChange={() => setRuleForm({ ...ruleForm, escalate_to_type: 'ROLE' })} /> By role
                      </label>
                      <label style={{ fontWeight: 400 }}>
                        <input type="radio" name="escalate_to_type" checked={ruleForm.escalate_to_type === 'PERSON'} onChange={() => setRuleForm({ ...ruleForm, escalate_to_type: 'PERSON' })} /> By specific person
                      </label>
                    </div>
                    {ruleForm.escalate_to_type === 'ROLE' ? (
                      <select style={inputStyle} value={ruleForm.escalate_to_role_code} onChange={(e) => setRuleForm({ ...ruleForm, escalate_to_role_code: e.target.value })}>
                        {roles.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
                      </select>
                    ) : (
                      <select style={inputStyle} value={ruleForm.escalate_to_user_id} onChange={(e) => setRuleForm({ ...ruleForm, escalate_to_user_id: e.target.value })} required>
                        <option value="">— Select —</option>
                        {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                      </select>
                    )}
                  </>
                )}

                {(ruleForm.trigger_type === 'REVENUE_ABOVE_THRESHOLD' || ruleForm.trigger_type === 'POST_APPROVAL_EDIT') && (
                  <>
                    <label style={{ ...label, marginTop: 20 }}>
                      <input
                        type="checkbox" checked={ruleForm.use_step2}
                        onChange={(e) => setRuleForm({ ...ruleForm, use_step2: e.target.checked })}
                        style={{ marginRight: 6 }}
                      />
                      Require a 2nd approval for this tier
                    </label>
                    <p style={{ fontSize: 12, color: '#5c6070', marginTop: 0 }}>
                      The approver above signs off first, then the person/role below must also approve before the
                      contract is actually Approved — useful for your highest tier (e.g. Finance, then Management).
                    </p>
                    {ruleForm.use_step2 && (
                      <>
                        <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
                          <label style={{ fontWeight: 400 }}>
                            <input type="radio" name="step2_approver_type" checked={ruleForm.step2_approver_type === 'ROLE'} onChange={() => setRuleForm({ ...ruleForm, step2_approver_type: 'ROLE' })} /> By role
                          </label>
                          <label style={{ fontWeight: 400 }}>
                            <input type="radio" name="step2_approver_type" checked={ruleForm.step2_approver_type === 'PERSON'} onChange={() => setRuleForm({ ...ruleForm, step2_approver_type: 'PERSON' })} /> By specific person
                          </label>
                        </div>
                        {ruleForm.step2_approver_type === 'ROLE' ? (
                          <select style={inputStyle} value={ruleForm.step2_approver_role_code} onChange={(e) => setRuleForm({ ...ruleForm, step2_approver_role_code: e.target.value })}>
                            {roles.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
                          </select>
                        ) : (
                          <select style={inputStyle} value={ruleForm.step2_approver_user_id} onChange={(e) => setRuleForm({ ...ruleForm, step2_approver_user_id: e.target.value })} required>
                            <option value="">— Select —</option>
                            {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                          </select>
                        )}
                      </>
                    )}
                  </>
                )}
              </>
            )}
            <button type="submit" style={{ padding: '8px 16px', marginTop: 16 }}>
              {ruleForm.trigger_type === 'BUDGET_APPROVAL' ? 'Save' : (ruleForm.id ? 'Save Changes' : 'Add Rule')}
            </button>
          </form>
        )}

        <table width="100%" cellPadding="6">
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
              <th>Trigger</th><th>Threshold</th><th>Event</th><th>Approver</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid #eee', opacity: r.is_active ? 1 : 0.5 }}>
                <td>{TRIGGER_LABELS[r.trigger_type] || r.trigger_type}</td>
                <td>
                  {r.threshold_value !== null ? `${Number(r.threshold_value).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${r.threshold_type === 'PERCENT' ? '%' : ''}` : '—'}
                  {r.trigger_type === 'REVENUE_ABOVE_THRESHOLD' && Number(r.threshold_value) === 0 && (
                    <span style={{ fontSize: 11, color: '#5c6070' }}> (default approver)</span>
                  )}
                </td>
                <td>{r.event_name || 'All events'}</td>
                <td>
                  {r.approver_user_name || r.approver_role_code || '—'}
                  {r.backup_approver_user_name && (
                    <div style={{ fontSize: 11, color: '#5c6070' }}>+ backup: {r.backup_approver_user_name}</div>
                  )}
                  {r.escalate_after_days && (
                    <div style={{ fontSize: 11, color: '#5c6070' }}>
                      escalates after {r.escalate_after_days}d to {r.escalate_to_user_name || r.escalate_to_role_code}
                    </div>
                  )}
                  {(r.step2_approver_user_name || r.step2_approver_role_code) && (
                    <div style={{ fontSize: 11, color: '#5c6070' }}>
                      then {r.step2_approver_user_name || r.step2_approver_role_code} (2nd approval)
                    </div>
                  )}
                </td>
                <td>{r.is_active ? 'Active' : 'Inactive'}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button onClick={() => startEditRule(r)}>Edit</button>{' '}
                  <button onClick={() => handleToggleRuleActive(r)}>{r.is_active ? 'Deactivate' : 'Activate'}</button>{' '}
                  <button onClick={() => handleDeleteRule(r)}>Delete</button>
                </td>
              </tr>
            ))}
            {/* Not a real approval_rules row (see BUDGET_APPROVAL above) —
                shown in the same list, but only once actually set, so an
                unconfigured chain doesn't read as an active rule. */}
            {(profileForm.budget_preparer_user_id || profileForm.budget_approver_user_id) && (
              <tr style={{ borderBottom: '1px solid #eee' }}>
                <td>{TRIGGER_LABELS.BUDGET_APPROVAL}</td>
                <td>—</td>
                <td>—</td>
                <td>
                  Prepares: {users.find((u) => u.id === profileForm.budget_preparer_user_id)?.full_name || 'Not set'}
                  {' · '}
                  Approves: {users.find((u) => u.id === profileForm.budget_approver_user_id)?.full_name || 'Not set'}
                </td>
                <td>Active</td>
                <td style={{ textAlign: 'right' }}>
                  <button onClick={startEditBudgetApproval}>Edit</button>
                </td>
              </tr>
            )}
            {rules.length === 0 && !(profileForm.budget_preparer_user_id || profileForm.budget_approver_user_id) && (
              <tr><td colSpan={6} style={{ color: '#5c6070', fontStyle: 'italic' }}>No rules configured yet — use "+ Add Rule" above.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      )}

      {activeTab === 'audit-log' && (
      <div style={section}>
        <h3>Audit Log</h3>
        <p style={{ fontSize: 13, color: '#5c6070' }}>
          Every login, failed login attempt and record change (create/update/delete) in this company, newest
          first — who did it, when, and on what. Read-only and append-only: nothing on this screen or elsewhere
          in LowForce can edit or remove an entry, which is what makes it usable as evidence for an external
          auditor.
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
          <div>
            <label style={label}>From</label>
            <input type="date" style={inputStyle} value={auditFilters.from} onChange={(e) => setAuditFilters({ ...auditFilters, from: e.target.value })} />
          </div>
          <div>
            <label style={label}>To</label>
            <input type="date" style={inputStyle} value={auditFilters.to} onChange={(e) => setAuditFilters({ ...auditFilters, to: e.target.value })} />
          </div>
          <div>
            <label style={label}>User</label>
            <select style={inputStyle} value={auditFilters.user_id} onChange={(e) => setAuditFilters({ ...auditFilters, user_id: e.target.value })}>
              <option value="">All users</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          </div>
          <div>
            <label style={label}>Entity</label>
            <select style={inputStyle} value={auditFilters.entity_type} onChange={(e) => setAuditFilters({ ...auditFilters, entity_type: e.target.value })}>
              <option value="">All entities</option>
              {auditEntityTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={label}>Action</label>
            <select style={inputStyle} value={auditFilters.action} onChange={(e) => setAuditFilters({ ...auditFilters, action: e.target.value })}>
              <option value="">All actions</option>
              {AUDIT_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <button type="button" onClick={loadAuditLog} disabled={auditLoading}>{auditLoading ? 'Searching...' : 'Search'}</button>
          <button type="button" onClick={() => { setAuditFilters(emptyAuditFilters); }}>Clear</button>
        </div>

        {auditEntries === null ? (
          <p>Loading...</p>
        ) : (
          <DataTable
            screenKey="admin-audit-log"
            columns={[
              { key: 'created_at', label: 'Time', value: (r) => new Date(r.created_at).toLocaleString('en-MY') },
              { key: 'user_name', label: 'User', render: (r) => r.user_name || '—' },
              { key: 'role_code', label: 'Role', render: (r) => r.role_code || '—' },
              { key: 'action', label: 'Action' },
              { key: 'entity_type', label: 'Entity' },
              { key: 'entity_id', label: 'Entity ID', render: (r) => r.entity_id || '—' },
              {
                key: 'details', label: 'Details',
                value: (r) => (r.details ? JSON.stringify(r.details) : ''),
                render: (r) => (
                  <span style={{ fontSize: 11, color: '#5c6070', fontFamily: 'monospace' }}>
                    {r.details ? JSON.stringify(r.details).slice(0, 120) : '—'}
                  </span>
                ),
              },
            ]}
            rows={auditEntries}
            getRowKey={(r) => r.id}
            exportFilename="audit-log"
            exportSheetName="Audit Log"
          />
        )}
        {auditEntries && auditEntries.length >= 2000 && (
          <p style={{ fontSize: 12, color: '#a15c00' }}>
            Showing the most recent 2,000 matching entries — narrow the date range for older activity.
          </p>
        )}
      </div>
      )}

      {activeTab === 'archived-records' && (
      <div style={section}>
        <h3>Archived Records</h3>
        <p style={{ fontSize: 13, color: '#5c6070' }}>
          Records deleted by an Admin (Exhibitors, Opportunities, Contracts, Invoices, Credit Notes, Payments) land
          here instead of being destroyed — nothing is gone for good. Restore brings one back everywhere it was
          hidden from.
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {ARCHIVE_TYPES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setArchiveType(t.key)}
              style={{ fontWeight: archiveType === t.key ? 700 : 400, background: archiveType === t.key ? '#E3F2FD' : undefined }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {archiveLoading || archivedRecords === null ? (
          <p>Loading...</p>
        ) : archivedRecords.length === 0 ? (
          <p style={{ fontSize: 13, color: '#5c6070' }}>Nothing deleted here.</p>
        ) : (
          <DataTable
            screenKey={`admin-archived-${archiveType}`}
            columns={[
              { key: '_label', label: 'Record', render: (r) => (
                <a
                  href={`${ARCHIVE_TYPES.find((t) => t.key === archiveType).path}/${r.id}`}
                  onClick={(e) => e.preventDefault()}
                  style={{ color: 'inherit', textDecoration: 'none' }}
                  title="Restore it first to reopen this record"
                >
                  {r._label}
                </a>
              ) },
              { key: 'deleted_by_name', label: 'Deleted By', render: (r) => r.deleted_by_name || '—' },
              { key: 'deleted_at', label: 'Deleted At', value: (r) => (r.deleted_at ? new Date(r.deleted_at).toLocaleString('en-MY') : '—') },
              { key: 'delete_reason', label: 'Reason', render: (r) => r.delete_reason || '—' },
              {
                key: 'restore', label: '', render: (r) => (
                  <button type="button" onClick={() => handleRestore(archiveType, r.id)}>Restore</button>
                ),
              },
            ]}
            rows={archivedRecords}
            getRowKey={(r) => r.id}
            exportFilename={`archived-${archiveType}`}
            exportSheetName="Archived"
          />
        )}
      </div>
      )}

      {activeTab === 'email-templates' && (
      <div style={section}>
        <h3>Email Templates</h3>
        <p style={{ fontSize: 13, color: '#5c6070' }}>
          Wording used when drafting the Tax Detail Link, Statement of Account and Outstanding Payment Reminder
          emails (see the Draft Email panel on each of those screens). Placeholders like <code>{'{{exhibitor_name}}'}</code>{' '}
          are filled in automatically when a draft is composed — leave any you don't need out of your wording, or
          leave one in if a screen doesn't happen to supply it and it'll show as plain text.
        </p>
        {Object.keys(emailTemplateDrafts).length === 0 ? (
          <p>Loading...</p>
        ) : (
          EMAIL_TEMPLATE_KEYS.map((key) => {
            const draft = emailTemplateDrafts[key] || { subject: '', body: '' };
            return (
              <div key={key} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 16 }}>
                <h4 style={{ marginTop: 0 }}>{EMAIL_TEMPLATE_LABELS[key]}</h4>
                <label style={label}>Subject</label>
                <input
                  style={inputStyle} value={draft.subject}
                  onChange={(e) => setEmailTemplateDrafts((d) => ({ ...d, [key]: { ...d[key], subject: e.target.value } }))}
                />
                <label style={label}>Body</label>
                <textarea
                  style={{ ...inputStyle, minHeight: 140 }} value={draft.body}
                  onChange={(e) => setEmailTemplateDrafts((d) => ({ ...d, [key]: { ...d[key], body: e.target.value } }))}
                />
                <button
                  type="button" disabled={savingTemplateKey === key} onClick={() => handleSaveEmailTemplate(key)}
                  style={{ marginTop: 8 }}
                >
                  {savingTemplateKey === key ? 'Saving...' : 'Save'}
                </button>
              </div>
            );
          })
        )}
      </div>
      )}
        </div>
      </div>
    </div>
  );
}
