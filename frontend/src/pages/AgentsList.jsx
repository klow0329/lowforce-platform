import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { TEMPLATE_CODES, FIXED_LABELS } from '../components/BillingTemplate';

const label = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, marginTop: 12 };
const inputStyle = { display: 'block', width: '100%', padding: 8, boxSizing: 'border-box' };

const emptyAgentForm = {
  id: null, name: '', name_alt: '', country_code: '', address: '', postcode: '', city: '', state: '',
  salesperson_id: '', reg_no: '', tin_no: '', sst_no: '', website: '', fax: '',
  contact_name: '', contact_job_title: '', contact_phone: '', contact_email: '',
};

// The commission rate table's first column — every standing billing item
// code (booth AND non-booth) plus a company-wide 'ALL REVENUE' catch-all,
// per the user's own request to price commission per specific item rather
// than a fixed Booth/Non-Booth split.
const COMMISSION_ITEM_CODES = ['ALL', ...TEMPLATE_CODES];
const commissionItemLabel = (code) => (code === 'ALL' ? 'ALL REVENUE' : (FIXED_LABELS[code] || code));

// Same casing convention as ExhibitorDetail's UPPERCASE_FIELDS — company
// name/address-type fields display uppercase, codes/URLs stay as typed.
const AGENT_UPPERCASE_FIELDS = ['name', 'name_alt', 'address', 'city', 'state', 'contact_name', 'contact_job_title'];
function normalizeAgentForm(form) {
  const out = { ...form };
  for (const key of Object.keys(out)) {
    if (typeof out[key] !== 'string') continue;
    if (key === 'contact_email') out[key] = out[key].trim().toLowerCase();
    else out[key] = AGENT_UPPERCASE_FIELDS.includes(key) ? out[key].trim().toUpperCase() : out[key].trim();
  }
  return out;
}

// The "Agent" field on an Exhibitor's record — its own top-level company
// profile (own company info, not a fixed list), same fields as Exhibitor's
// own company-info section, and same rule: a rename or detail change here
// shows up everywhere the agent is referenced (contracts, invoices, Floor
// Plan, print docs) automatically since those all read it live.
export default function AgentsList({ user }) {
  const [agents, setAgents] = useState([]);
  const [countries, setCountries] = useState([]);
  const [salespeople, setSalespeople] = useState([]);
  const [agentForm, setAgentForm] = useState(emptyAgentForm);
  const [showAgentForm, setShowAgentForm] = useState(false);
  const [error, setError] = useState('');
  // Everyone can view the list (see settings.routes.js's open GET /agents),
  // but write access is narrower: creating a brand-new agent stays
  // Admin-only, while editing an existing one is also open to whichever
  // salesperson that agent is assigned to (mirrored from updateAgent's own
  // ownership check server-side) — anyone else sees the row read-only.
  const isAdmin = user?.role_code === 'ADM';
  const canEditAgent = (a) => isAdmin || (a.salesperson_id && a.salesperson_id === user?.id);

  // Commission is an open rate table per agent (item code x exhibitor tier
  // -> %), not a single flat number — a company can price any billing item
  // differently (or set an 'ALL REVENUE' catch-all), and add a further tier
  // beyond repeat/new later, so rows are free-form rather than a fixed grid.
  const [commissionAgentId, setCommissionAgentId] = useState(null);
  const [commissionRows, setCommissionRows] = useState([]);
  const [commissionBusy, setCommissionBusy] = useState(false);
  // Bonus tiers — an ADDITIONAL % once the agent's total revenue (MYR) or
  // sqm for the event crosses a threshold, on top of the rate table above.
  const [bonusRows, setBonusRows] = useState([]);
  const [bonusBusy, setBonusBusy] = useState(false);

  // Main event(s) an agent is linked to (2026-08-05) — a standing fact
  // about the agent, not per-year, and can be MORE THAN ONE: "imagine like
  // SIAL international, which [runs] across the region with different
  // events" (user's own example).
  const [mainEvents, setMainEvents] = useState([]);
  const [mainEventsAgentId, setMainEventsAgentId] = useState(null);
  const [selectedMainEventIds, setSelectedMainEventIds] = useState([]);
  const [mainEventsBusy, setMainEventsBusy] = useState(false);

  function openMainEventsEditor(agent) {
    setMainEventsAgentId(agent.id);
    setSelectedMainEventIds(agent.main_event_ids || []);
  }

  function toggleMainEvent(id) {
    setSelectedMainEventIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  async function handleSaveMainEvents() {
    setMainEventsBusy(true);
    setError('');
    try {
      await api.setAgentMainEvents(mainEventsAgentId, selectedMainEventIds);
      setMainEventsAgentId(null);
      loadAgents();
    } catch (err) {
      setError(err.message);
    } finally {
      setMainEventsBusy(false);
    }
  }

  function loadAgents() {
    api.listAgentsAdmin().then(({ agents }) => setAgents(agents));
  }

  async function openCommissionEditor(agent) {
    setError('');
    const [{ commissionRates }, { bonusTiers }] = await Promise.all([
      api.listAgentCommissionRates(agent.id),
      api.listAgentCommissionBonusTiers(agent.id),
    ]);
    setCommissionRows(
      commissionRates.length > 0
        ? commissionRates.map((r) => ({ item_code: r.item_code, exhibitor_tier: r.exhibitor_tier, rate_pct: String(r.rate_pct) }))
        : [
            { item_code: 'BAS', exhibitor_tier: 'REPEAT', rate_pct: '' },
            { item_code: 'BAS', exhibitor_tier: 'NEW', rate_pct: '' },
          ]
    );
    setBonusRows(
      bonusTiers.map((b) => ({
        threshold_type: b.threshold_type, threshold_value: String(b.threshold_value), bonus_pct: String(b.bonus_pct),
      }))
    );
    setCommissionAgentId(agent.id);
  }

  function addCommissionRow() {
    setCommissionRows((rows) => [...rows, { item_code: 'BAS', exhibitor_tier: 'REPEAT', rate_pct: '' }]);
  }

  function removeCommissionRow(i) {
    setCommissionRows((rows) => rows.filter((_, idx) => idx !== i));
  }

  async function handleSaveCommissionRates() {
    if (!window.confirm('Save these commission rates?')) return;
    setCommissionBusy(true);
    setError('');
    try {
      await api.saveAgentCommissionRates(commissionAgentId, commissionRows);
    } catch (err) {
      setError(err.message);
    } finally {
      setCommissionBusy(false);
    }
  }

  function addBonusRow() {
    setBonusRows((rows) => [...rows, { threshold_type: 'REVENUE_MYR', threshold_value: '', bonus_pct: '' }]);
  }

  function removeBonusRow(i) {
    setBonusRows((rows) => rows.filter((_, idx) => idx !== i));
  }

  async function handleSaveBonusTiers() {
    if (!window.confirm('Save these bonus tiers?')) return;
    setBonusBusy(true);
    setError('');
    try {
      await api.saveAgentCommissionBonusTiers(commissionAgentId, bonusRows);
    } catch (err) {
      setError(err.message);
    } finally {
      setBonusBusy(false);
    }
  }

  useEffect(() => {
    loadAgents();
    api.listCountries().then(({ countries }) => setCountries(countries));
    api.listSalespeople().then(({ salespeople }) => setSalespeople(salespeople));
    api.listMainEvents().then(({ mainEvents }) => setMainEvents(mainEvents));
  }, []);

  async function handleSaveAgent(e) {
    e.preventDefault();
    setError('');
    if (!window.confirm(agentForm.id ? `Save changes to ${agentForm.name}?` : `Add agent ${agentForm.name}?`)) return;
    try {
      const { id, ...rest } = normalizeAgentForm(agentForm);
      if (id) await api.updateAgent(id, rest);
      else await api.createAgent(rest);
      setAgentForm(emptyAgentForm);
      setShowAgentForm(false);
      loadAgents();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleToggleAgentActive(a) {
    setError('');
    if (!window.confirm(`${a.is_active ? 'Deactivate' : 'Activate'} ${a.name}?`)) return;
    try {
      await api.updateAgent(a.id, { is_active: !a.is_active });
      loadAgents();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="page" style={{ maxWidth: 900, margin: '40px auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2>Sales Agents</h2>
        {isAdmin && (
          <button onClick={() => { setAgentForm(emptyAgentForm); setShowAgentForm(!showAgentForm); }}>
            {showAgentForm ? 'Cancel' : '+ Add Agent'}
          </button>
        )}
      </div>
      {error && <p style={{ color: 'red', fontWeight: 600 }}>{error}</p>}

      {showAgentForm && (
        <form onSubmit={handleSaveAgent} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <label style={label}>Short Name *</label>
          <p style={{ fontSize: 12, color: '#5c6070', marginTop: 0 }}>
            The abbreviation used everywhere in lists and dropdowns (e.g. "TRADEXPO").
          </p>
          <input style={inputStyle} value={agentForm.name} onChange={(e) => setAgentForm({ ...agentForm, name: e.target.value })} required />
          <label style={label}>Full Name</label>
          <p style={{ fontSize: 12, color: '#5c6070', marginTop: 0 }}>
            The agent's full legal/company name, for documents where the abbreviation isn't enough (e.g. "TRADEXPO SDN BHD").
          </p>
          <input style={inputStyle} value={agentForm.name_alt} onChange={(e) => setAgentForm({ ...agentForm, name_alt: e.target.value })} />

          <label style={label}>Address</label>
          <input style={inputStyle} value={agentForm.address} onChange={(e) => setAgentForm({ ...agentForm, address: e.target.value })} />
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={label}>Postcode</label>
              <input style={inputStyle} value={agentForm.postcode} onChange={(e) => setAgentForm({ ...agentForm, postcode: e.target.value })} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={label}>City</label>
              <input style={inputStyle} value={agentForm.city} onChange={(e) => setAgentForm({ ...agentForm, city: e.target.value })} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={label}>State</label>
              <input style={inputStyle} value={agentForm.state} onChange={(e) => setAgentForm({ ...agentForm, state: e.target.value })} />
            </div>
          </div>
          <label style={label}>Country</label>
          <select style={inputStyle} value={agentForm.country_code} onChange={(e) => setAgentForm({ ...agentForm, country_code: e.target.value })}>
            <option value="">— Select —</option>
            {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>

          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={label}>Contact Person</label>
              <input style={inputStyle} value={agentForm.contact_name} onChange={(e) => setAgentForm({ ...agentForm, contact_name: e.target.value })} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={label}>Job Title</label>
              <input style={inputStyle} value={agentForm.contact_job_title} onChange={(e) => setAgentForm({ ...agentForm, contact_job_title: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={label}>Contact Phone</label>
              <input
                style={inputStyle} value={agentForm.contact_phone} inputMode="numeric"
                placeholder="Country code first, e.g. 60123456789"
                onChange={(e) => setAgentForm({ ...agentForm, contact_phone: e.target.value.replace(/\D/g, '') })}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={label}>Contact Email</label>
              <input type="email" style={inputStyle} value={agentForm.contact_email} onChange={(e) => setAgentForm({ ...agentForm, contact_email: e.target.value })} />
            </div>
          </div>

          <label style={label}>Salesperson</label>
          <select style={inputStyle} value={agentForm.salesperson_id} onChange={(e) => setAgentForm({ ...agentForm, salesperson_id: e.target.value })}>
            <option value="">— Unassigned —</option>
            {salespeople.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select>

          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={label}>Co. Reg No.</label>
              <input style={inputStyle} value={agentForm.reg_no} onChange={(e) => setAgentForm({ ...agentForm, reg_no: e.target.value })} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={label}>TIN No.</label>
              <input style={inputStyle} value={agentForm.tin_no} onChange={(e) => setAgentForm({ ...agentForm, tin_no: e.target.value })} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={label}>SST No.</label>
              <input style={inputStyle} value={agentForm.sst_no} onChange={(e) => setAgentForm({ ...agentForm, sst_no: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={label}>Website</label>
              <input style={inputStyle} value={agentForm.website} onChange={(e) => setAgentForm({ ...agentForm, website: e.target.value })} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={label}>Fax</label>
              <input style={inputStyle} value={agentForm.fax} onChange={(e) => setAgentForm({ ...agentForm, fax: e.target.value })} />
            </div>
          </div>
          <button type="submit" style={{ padding: '8px 16px', marginTop: 16 }}>{agentForm.id ? 'Save Changes' : 'Add Agent'}</button>
        </form>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table width="100%" cellPadding="6">
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
              <th>Short Name</th><th>Full Name</th><th>Contact Person</th><th>Phone</th><th>Email</th><th>Country</th><th>Salesperson</th><th>Main Event(s)</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => (
              <>
              <tr key={a.id} style={{ borderBottom: '1px solid #eee', opacity: a.is_active ? 1 : 0.5 }}>
                <td>{a.name}</td>
                <td>{a.name_alt || '—'}</td>
                <td>{a.contact_name || '—'}</td>
                <td>{a.contact_phone || '—'}</td>
                <td>{a.contact_email || '—'}</td>
                <td>{a.country_name || '—'}</td>
                <td>{a.salesperson_name || '—'}</td>
                <td>{a.main_event_names || '—'}</td>
                <td>{a.is_active ? 'Active' : 'Inactive'}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {canEditAgent(a) && (
                    <>
                      <button
                        onClick={() => {
                          setAgentForm({
                            id: a.id, name: a.name || '', name_alt: a.name_alt || '', country_code: a.country_code || '',
                            address: a.address || '', postcode: a.postcode || '', city: a.city || '', state: a.state || '',
                            salesperson_id: a.salesperson_id || '', reg_no: a.reg_no || '', tin_no: a.tin_no || '',
                            sst_no: a.sst_no || '', website: a.website || '', fax: a.fax || '',
                            contact_name: a.contact_name || '', contact_job_title: a.contact_job_title || '',
                            contact_phone: a.contact_phone || '', contact_email: a.contact_email || '',
                          });
                          setShowAgentForm(true);
                        }}
                      >
                        Edit
                      </button>{' '}
                      <button onClick={() => handleToggleAgentActive(a)}>{a.is_active ? 'Deactivate' : 'Activate'}</button>{' '}
                      <button onClick={() => (commissionAgentId === a.id ? setCommissionAgentId(null) : openCommissionEditor(a))}>
                        {commissionAgentId === a.id ? 'Close' : 'Commission Rates'}
                      </button>{' '}
                      {isAdmin && (
                        <button onClick={() => (mainEventsAgentId === a.id ? setMainEventsAgentId(null) : openMainEventsEditor(a))}>
                          {mainEventsAgentId === a.id ? 'Close' : 'Main Events'}
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
              {mainEventsAgentId === a.id && (
                <tr>
                  <td colSpan={10} style={{ background: '#F5F6FA', padding: 12 }}>
                    <p style={{ fontSize: 12, color: '#5c6070', margin: '0 0 8px' }}>
                      Which Main event(s) {a.name} represents — a standing fact about the agent, not per-year. Select
                      more than one if this agent brings exhibitors to several of your event brands.
                    </p>
                    {mainEvents.length === 0 && <p style={{ fontSize: 12, color: '#5c6070' }}>No Main events set up yet — see Admin &gt; Events.</p>}
                    {mainEvents.map((m) => (
                      <label key={m.id} style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>
                        <input type="checkbox" checked={selectedMainEventIds.includes(m.id)} onChange={() => toggleMainEvent(m.id)} />
                        {' '}{m.name}
                      </label>
                    ))}
                    <button type="button" disabled={mainEventsBusy} onClick={handleSaveMainEvents} style={{ marginTop: 8 }}>
                      {mainEventsBusy ? 'Saving...' : 'Save Main Events'}
                    </button>
                  </td>
                </tr>
              )}
              {commissionAgentId === a.id && (
                <tr>
                  <td colSpan={10} style={{ background: '#F5F6FA', padding: 12 }}>
                    <p style={{ fontSize: 12, color: '#5c6070', margin: '0 0 8px' }}>
                      Commission rate for {a.name} — pick any billing item (or "ALL REVENUE" as a catch-all) and a
                      rate for repeat-from-last-year vs new exhibitors. A specific item's rate wins over ALL REVENUE
                      when both are set for the same tier.
                    </p>
                    {commissionRows.map((row, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                        <select
                          style={{ ...inputStyle, width: 220 }} value={row.item_code}
                          onChange={(e) => setCommissionRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, item_code: e.target.value } : r)))}
                        >
                          {COMMISSION_ITEM_CODES.map((code) => (
                            <option key={code} value={code}>{commissionItemLabel(code)}</option>
                          ))}
                        </select>
                        <select
                          style={{ ...inputStyle, width: 140 }} value={row.exhibitor_tier}
                          onChange={(e) => setCommissionRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, exhibitor_tier: e.target.value } : r)))}
                        >
                          <option value="REPEAT">Repeat Exhibitor</option>
                          <option value="NEW">New Exhibitor</option>
                        </select>
                        <input
                          type="number" step="0.01" style={{ ...inputStyle, width: 90 }} placeholder="%"
                          value={row.rate_pct}
                          onChange={(e) => setCommissionRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, rate_pct: e.target.value } : r)))}
                        />
                        <span style={{ fontSize: 13 }}>%</span>
                        <button type="button" onClick={() => removeCommissionRow(i)}>Remove</button>
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button type="button" onClick={addCommissionRow}>+ Add Row</button>
                      <button type="button" onClick={handleSaveCommissionRates} disabled={commissionBusy}>
                        {commissionBusy ? 'Saving...' : 'Save Commission Rates'}
                      </button>
                    </div>

                    <h4 style={{ marginBottom: 4, marginTop: 24 }}>Bonus Tiers</h4>
                    <p style={{ fontSize: 12, color: '#5c6070', margin: '0 0 8px' }}>
                      An extra % on top of the rate table above, once {a.name}'s total revenue (in RM) or sqm for the
                      event crosses a threshold. Compared and paid in RM, since a threshold needs one comparable
                      number even when the underlying invoices are in different currencies.
                    </p>
                    {bonusRows.map((row, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                        <select
                          style={{ ...inputStyle, width: 160 }} value={row.threshold_type}
                          onChange={(e) => setBonusRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, threshold_type: e.target.value } : r)))}
                        >
                          <option value="REVENUE_MYR">Revenue (RM) at least</option>
                          <option value="SQM">Sqm at least</option>
                        </select>
                        <input
                          type="number" step="0.01" style={{ ...inputStyle, width: 130 }}
                          placeholder={row.threshold_type === 'SQM' ? 'sqm' : 'RM'}
                          value={row.threshold_value}
                          onChange={(e) => setBonusRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, threshold_value: e.target.value } : r)))}
                        />
                        <span style={{ fontSize: 13 }}>→ bonus</span>
                        <input
                          type="number" step="0.01" style={{ ...inputStyle, width: 90 }} placeholder="%"
                          value={row.bonus_pct}
                          onChange={(e) => setBonusRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, bonus_pct: e.target.value } : r)))}
                        />
                        <span style={{ fontSize: 13 }}>%</span>
                        <button type="button" onClick={() => removeBonusRow(i)}>Remove</button>
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button type="button" onClick={addBonusRow}>+ Add Bonus Tier</button>
                      <button type="button" onClick={handleSaveBonusTiers} disabled={bonusBusy}>
                        {bonusBusy ? 'Saving...' : 'Save Bonus Tiers'}
                      </button>
                    </div>
                  </td>
                </tr>
              )}
              </>
            ))}
            {agents.length === 0 && <tr><td colSpan={10} style={{ fontSize: 13, color: '#5c6070' }}>None set up yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
