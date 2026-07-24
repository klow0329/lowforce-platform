import { useEffect, useState } from 'react';
import { api } from '../api/client';
import DataTable from '../components/DataTable';

const label = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, marginTop: 12 };
const inputStyle = { display: 'block', width: '100%', padding: 8, boxSizing: 'border-box' };
const section = { marginBottom: 40 };

const emptyUserForm = { email: '', full_name: '', role_id: '', temp_password: '' };
const emptyEventForm = { id: null, code: '', name: '', event_year: '', start_date: '', end_date: '', parent_event_id: '' };
const emptyTaxCodeForm = { id: null, code: '', name: '', rate_pct: '' };
const emptyRuleForm = { id: null, trigger_type: 'DISCOUNT_ABOVE_THRESHOLD', threshold_type: '', threshold_value: '', approver_type: 'ROLE', approver_role_code: 'ADM', approver_user_id: '' };
// NEW_CONTRACT used to be an opt-in trigger for the new-contract approval
// gate — that gate is now mandatory for every contract regardless (see the
// Draft -> Send for Approval flow), so it's no longer a configurable rule.
// TAX_CHANGE was retired 2026-07-23 — a tax code change on an approved
// contract is just one flavour of POST_APPROVAL_EDIT, which already covers
// it, so having both was redundant. Both are kept in TRIGGER_LABELS (not
// this list) so any old rows still display correctly.
const SELECTABLE_TRIGGERS = ['DISCOUNT_ABOVE_THRESHOLD', 'REVENUE_ABOVE_THRESHOLD', 'POST_APPROVAL_EDIT', 'CREDIT_NOTE_ISSUED', 'BUDGET_APPROVAL'];
const emptyProfileForm = {
  reg_no: '', tin_no: '', sst_no: '', address: '', phone: '', email: '',
  bank_name: '', bank_account_no: '', bank_swift: '', payment_instructions: '',
  budget_preparer_user_id: '', budget_approver_user_id: '',
};
const emptyExpenseCodeForm = { id: null, code: '', description: '' };

const TRIGGER_LABELS = {
  NEW_CONTRACT: 'New contract submitted',
  DISCOUNT_ABOVE_THRESHOLD: 'Line item discount above threshold',
  TAX_CHANGE: 'Tax code changed on an approved contract (retired — see "Contract edited after approval")',
  REVENUE_ABOVE_THRESHOLD: 'Contract total value above threshold',
  POST_APPROVAL_EDIT: 'Contract edited after approval',
  CREDIT_NOTE_ISSUED: 'Credit note above threshold',
  BUDGET_APPROVAL: 'Budget preparer & approver',
};

// Shown inline, only for whichever trigger is currently selected in the Add/
// Edit Rule form — replaces a permanently-visible reference table that took
// up screen space and (per user feedback) read as if it were itself a set
// of active rules rather than just explanatory text.
const TRIGGER_HELP = {
  DISCOUNT_ABOVE_THRESHOLD: "Fires when any contract line's discount exceeds the % or flat amount below, on a new or existing contract.",
  REVENUE_ABOVE_THRESHOLD: "Fires when a contract's total (in MYR) crosses the amount below. Add several of these to build a tiered matrix — e.g. RM100,000 to a Finance Manager, RM1,000,000 to a CFO — LowForce uses whichever threshold is the highest one the contract still clears (not every tier at once). Below every threshold, or with none configured, any Admin/Management can approve; Admin always can, regardless of tier.",
  POST_APPROVAL_EDIT: 'Fires on any change (price, tax code, item, discount) to a contract that was already approved — including a tax code change, which is just one kind of this. No threshold; any edit qualifies.',
  CREDIT_NOTE_ISSUED: "Fires when a credit note issued against an invoice/contract exceeds the amount below. Not yet an active document type in LowForce — configure now, takes effect automatically once that feature ships.",
  BUDGET_APPROVAL: 'A separate approval chain for the Budget module — a fixed named person to prepare, a fixed named person to approve, rather than a role or threshold. Admin can also always prepare or approve as a fallback.',
};

const TABS = [
  { key: 'users', label: 'Users' },
  { key: 'events', label: 'Events' },
  { key: 'exchange-rate', label: 'Exchange Rate' },
  { key: 'company-profile', label: 'Company Profile' },
  { key: 'tax-codes', label: 'Tax Codes' },
  { key: 'expense-codes', label: 'Expense Codes' },
  { key: 'approval-rules', label: 'Approval Rules' },
  { key: 'audit-log', label: 'Audit Log' },
];

const AUDIT_ACTIONS = ['LOGIN', 'FAILED_LOGIN', 'LOGOUT', 'POST', 'PUT', 'PATCH', 'DELETE'];
const emptyAuditFilters = { from: '', to: '', user_id: '', entity_type: '', action: '' };

export default function Admin({ user }) {
  const [activeTab, setActiveTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
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
  const [branding, setBranding] = useState({ logo: false, letterhead: false, footer: false });
  const [brandingBust, setBrandingBust] = useState(0); // cache-buster after upload/delete
  const [brandingUploading, setBrandingUploading] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [rules, setRules] = useState([]);
  const [ruleForm, setRuleForm] = useState(emptyRuleForm);
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [expenseCodes, setExpenseCodes] = useState([]);
  const [expenseCodeForm, setExpenseCodeForm] = useState(emptyExpenseCodeForm);
  const [showExpenseCodeForm, setShowExpenseCodeForm] = useState(false);

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

  function loadAll() {
    api.adminListUsers().then(({ users }) => setUsers(users));
    api.adminListEvents().then(({ events }) => setEvents(events));
  }

  function loadCurrencyAndApprovals() {
    api.listTaxCodes().then(({ taxCodes }) => setTaxCodes(taxCodes));
    api.listExpenseCodes().then(({ expenseCodes }) => setExpenseCodes(expenseCodes));
    api.getSettings().then(({ settings }) => {
      setExchangeRate(settings.usd_to_myr_rate);
      setProfileForm({
        reg_no: settings.reg_no || '', tin_no: settings.tin_no || '', sst_no: settings.sst_no || '',
        address: settings.address || '', phone: settings.phone || '', email: settings.email || '',
        bank_name: settings.bank_name || '', bank_account_no: settings.bank_account_no || '',
        bank_swift: settings.bank_swift || '', payment_instructions: settings.payment_instructions || '',
        budget_preparer_user_id: settings.budget_preparer_user_id || '',
        budget_approver_user_id: settings.budget_approver_user_id || '',
      });
      setBranding({ logo: settings.has_logo, letterhead: settings.has_letterhead, footer: settings.has_footer });
    });
    api.listApprovalRules().then(({ rules }) => setRules(rules));
  }

  useEffect(() => {
    loadAll();
    loadCurrencyAndApprovals();
    api.adminListRoles().then(({ roles }) => setRoles(roles));
  }, []);

  // Loads lazily the first time the tab is opened, then only again when the
  // user clicks Search — not on every keystroke in the filter fields.
  useEffect(() => {
    if (activeTab === 'audit-log' && auditEntries === null) loadAuditLog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

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
        await api.updateExpenseCode(id, { description: payload.description });
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
    } catch (err) {
      setError(err.message);
    } finally {
      setBrandingUploading('');
    }
  }

  async function handleDeleteBranding(type) {
    if (!window.confirm(`Remove the ${type} image? Documents will fall back to plain text where this was used.`)) return;
    setError('');
    try {
      await api.deleteBrandingImage(type);
      setBranding((b) => ({ ...b, [type]: false }));
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
      const { id, approver_type, ...rest } = ruleForm;
      const payload = {
        ...rest,
        approver_role_code: approver_type === 'ROLE' ? rest.approver_role_code : null,
        approver_user_id: approver_type === 'PERSON' ? rest.approver_user_id : null,
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
    const newPassword = window.prompt(`New temporary password for ${u.full_name} (min 8 characters):`);
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
    });
    setShowEventForm(true);
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
            <label style={label}>Temporary Password (min 8 characters — the user should change it after first login)</label>
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
            <label style={label}>Code (short, e.g. MIFB27 — can't be changed later)</label>
            <input style={inputStyle} value={eventForm.code} onChange={(e) => setEventForm({ ...eventForm, code: e.target.value })} required disabled={!!eventForm.id} />
            <label style={label}>Name</label>
            <input style={inputStyle} value={eventForm.name} onChange={(e) => setEventForm({ ...eventForm, name: e.target.value })} required />
            <label style={label}>Year</label>
            <input type="number" style={inputStyle} value={eventForm.event_year} onChange={(e) => setEventForm({ ...eventForm, event_year: e.target.value })} />
            <label style={label}>Start Date</label>
            <input type="date" style={inputStyle} value={eventForm.start_date} onChange={(e) => setEventForm({ ...eventForm, start_date: e.target.value })} />
            <label style={label}>End Date</label>
            <input type="date" style={inputStyle} value={eventForm.end_date} onChange={(e) => setEventForm({ ...eventForm, end_date: e.target.value })} />
            <label style={label}>Sub-event of (optional — e.g. MYFT/MCE under MIFB)</label>
            <select style={inputStyle} value={eventForm.parent_event_id} onChange={(e) => setEventForm({ ...eventForm, parent_event_id: e.target.value })}>
              <option value="">— None (main event) —</option>
              {events.filter((ev) => ev.id !== eventForm.id && !ev.parent_event_id).map((ev) => (
                <option key={ev.id} value={ev.id}>{ev.name}</option>
              ))}
            </select>
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
              <th>Dates</th>
              <th>Type</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {events
              .filter((ev) => !ev.parent_event_id)
              .flatMap((main) => [main, ...events.filter((ev) => ev.parent_event_id === main.id)])
              .map((ev) => (
              <tr key={ev.id} style={{ borderBottom: '1px solid #eee', opacity: ev.is_active ? 1 : 0.5 }}>
                <td style={ev.parent_event_id ? { paddingLeft: 28 } : { fontWeight: 600 }}>
                  {ev.parent_event_id ? '↳ ' : ''}{ev.code}
                </td>
                <td>{ev.name}</td>
                <td>{ev.event_year || '—'}</td>
                <td>{ev.start_date && ev.end_date ? `${ev.start_date} → ${ev.end_date}` : '—'}</td>
                <td>{ev.parent_event_id ? `Sub-event of ${ev.parent_code}` : 'Main'}</td>
                <td>{ev.is_active ? 'Active' : 'Inactive'}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
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
          Statement this company generates. PNG/JPG, up to 5MB each.
        </p>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
          {[
            { type: 'logo', label: 'Logo', hint: 'Square-ish, shown top-left of documents' },
            { type: 'letterhead', label: 'Letterhead Header', hint: 'Wide strip across the top' },
            { type: 'footer', label: 'Footer', hint: 'Wide strip across the bottom' },
          ].map(({ type, label, hint }) => (
            <div key={type} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, width: 220 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 11, color: '#5c6070', marginBottom: 8 }}>{hint}</div>
              <div style={{
                height: 70, background: '#f5f6fa', border: '1px dashed #ccc', borderRadius: 6,
                display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8, overflow: 'hidden',
              }}>
                {branding[type] ? (
                  <img
                    src={`${api.brandingImageUrl(type)}?v=${brandingBust}`}
                    alt={label}
                    style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }}
                  />
                ) : (
                  <span style={{ fontSize: 11, color: '#aaa' }}>Not uploaded</span>
                )}
              </div>
              <label style={{ display: 'inline-block', fontSize: 12, cursor: 'pointer' }}>
                {brandingUploading === type ? 'Uploading...' : (branding[type] ? 'Replace' : 'Upload')}
                <input
                  type="file" accept="image/*" style={{ display: 'none' }}
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
            <button type="submit" style={{ padding: '8px 16px', marginTop: 16 }}>{expenseCodeForm.id ? 'Save Changes' : 'Add Expense Code'}</button>
          </form>
        )}

        <table width="100%" cellPadding="6">
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
              <th>Code</th><th>Description</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {expenseCodes.map((ec) => (
              <tr key={ec.id} style={{ borderBottom: '1px solid #eee', opacity: ec.is_active ? 1 : 0.5 }}>
                <td>{ec.code}</td>
                <td>{ec.description}</td>
                <td>{ec.is_active ? 'Active' : 'Inactive'}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button onClick={() => { setExpenseCodeForm({ id: ec.id, code: ec.code, description: ec.description }); setShowExpenseCodeForm(true); }}>Edit</button>{' '}
                  <button onClick={() => handleToggleExpenseCodeActive(ec)}>{ec.is_active ? 'Deactivate' : 'Activate'}</button>
                </td>
              </tr>
            ))}
            {expenseCodes.length === 0 && <tr><td colSpan={4} style={{ fontSize: 13, color: '#5c6070' }}>None set up yet.</td></tr>}
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
                {(ruleForm.trigger_type === 'REVENUE_ABOVE_THRESHOLD' || ruleForm.trigger_type === 'CREDIT_NOTE_ISSUED') && (
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
                  <select style={inputStyle} value={ruleForm.approver_role_code} onChange={(e) => setRuleForm({ ...ruleForm, approver_role_code: e.target.value })}>
                    <option value="ADM">Admin</option>
                    <option value="MGT">Management</option>
                  </select>
                ) : (
                  <select style={inputStyle} value={ruleForm.approver_user_id} onChange={(e) => setRuleForm({ ...ruleForm, approver_user_id: e.target.value })} required>
                    <option value="">— Select —</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                  </select>
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
              <th>Trigger</th><th>Threshold</th><th>Approver</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid #eee', opacity: r.is_active ? 1 : 0.5 }}>
                <td>{TRIGGER_LABELS[r.trigger_type] || r.trigger_type}</td>
                <td>{r.threshold_value !== null ? `${Number(r.threshold_value).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${r.threshold_type === 'PERCENT' ? '%' : ''}` : '—'}</td>
                <td>{r.approver_user_name || r.approver_role_code || '—'}</td>
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
              <tr><td colSpan={5} style={{ color: '#5c6070', fontStyle: 'italic' }}>No rules configured yet — use "+ Add Rule" above.</td></tr>
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
        </div>
      </div>
    </div>
  );
}
