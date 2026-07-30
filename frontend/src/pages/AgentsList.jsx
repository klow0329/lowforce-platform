import { useEffect, useState } from 'react';
import { api } from '../api/client';

const label = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, marginTop: 12 };
const inputStyle = { display: 'block', width: '100%', padding: 8, boxSizing: 'border-box' };

const emptyAgentForm = {
  id: null, name: '', name_alt: '', country_code: '', address: '', postcode: '', city: '', state: '',
  salesperson_id: '', reg_no: '', tin_no: '', sst_no: '', website: '', fax: '', comm_rate: '',
};

// Same casing convention as ExhibitorDetail's UPPERCASE_FIELDS — company
// name/address-type fields display uppercase, codes/URLs stay as typed.
const AGENT_UPPERCASE_FIELDS = ['name', 'name_alt', 'address', 'city', 'state'];
function normalizeAgentForm(form) {
  const out = { ...form };
  for (const key of Object.keys(out)) {
    if (typeof out[key] !== 'string') continue;
    out[key] = AGENT_UPPERCASE_FIELDS.includes(key) ? out[key].trim().toUpperCase() : out[key].trim();
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

  // Commission is an open rate table per agent (category x exhibitor tier
  // -> %), not a single flat number — a company may want a different rate
  // for non-booth revenue, or a further tier beyond repeat/new later, so
  // rows are free-form rather than a fixed 2x2 grid.
  const [commissionAgentId, setCommissionAgentId] = useState(null);
  const [commissionRows, setCommissionRows] = useState([]);
  const [commissionBusy, setCommissionBusy] = useState(false);

  function loadAgents() {
    api.listAgentsAdmin().then(({ agents }) => setAgents(agents));
  }

  async function openCommissionEditor(agent) {
    setError('');
    const { commissionRates } = await api.listAgentCommissionRates(agent.id);
    setCommissionRows(
      commissionRates.length > 0
        ? commissionRates.map((r) => ({ category: r.category, exhibitor_tier: r.exhibitor_tier, rate_pct: String(r.rate_pct) }))
        : [
            { category: 'BOOTH', exhibitor_tier: 'REPEAT', rate_pct: '' },
            { category: 'BOOTH', exhibitor_tier: 'NEW', rate_pct: '' },
          ]
    );
    setCommissionAgentId(agent.id);
  }

  function addCommissionRow() {
    setCommissionRows((rows) => [...rows, { category: 'BOOTH', exhibitor_tier: 'REPEAT', rate_pct: '' }]);
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
      setCommissionAgentId(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setCommissionBusy(false);
    }
  }

  useEffect(() => {
    loadAgents();
    api.listCountries().then(({ countries }) => setCountries(countries));
    api.listSalespeople().then(({ salespeople }) => setSalespeople(salespeople));
  }, []);

  async function handleSaveAgent(e) {
    e.preventDefault();
    setError('');
    if (!window.confirm(agentForm.id ? `Save changes to ${agentForm.name}?` : `Add agent ${agentForm.name}?`)) return;
    try {
      const { id, ...rest } = normalizeAgentForm(agentForm);
      const payload = { ...rest, comm_rate: rest.comm_rate || 0 };
      if (id) await api.updateAgent(id, payload);
      else await api.createAgent(payload);
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
      <p style={{ fontSize: 13, color: '#5c6070' }}>
        The Agent field on an Exhibitor's record — a company profile record (own company info, not a fixed list),
        same fields as Exhibitor's own company-info section.
      </p>
      {error && <p style={{ color: 'red', fontWeight: 600 }}>{error}</p>}

      {showAgentForm && (
        <form onSubmit={handleSaveAgent} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <label style={label}>Agent Name *</label>
          <input style={inputStyle} value={agentForm.name} onChange={(e) => setAgentForm({ ...agentForm, name: e.target.value })} required />
          <label style={label}>Alt Name</label>
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
          <label style={label}>Commission Rate (%)</label>
          <input type="number" step="0.01" style={inputStyle} value={agentForm.comm_rate} onChange={(e) => setAgentForm({ ...agentForm, comm_rate: e.target.value })} />
          <button type="submit" style={{ padding: '8px 16px', marginTop: 16 }}>{agentForm.id ? 'Save Changes' : 'Add Agent'}</button>
        </form>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table width="100%" cellPadding="6">
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
              <th>Name</th><th>Country</th><th>Salesperson</th><th>Commission Rate</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => (
              <>
              <tr key={a.id} style={{ borderBottom: '1px solid #eee', opacity: a.is_active ? 1 : 0.5 }}>
                <td>{a.name}</td>
                <td>{a.country_name || '—'}</td>
                <td>{a.salesperson_name || '—'}</td>
                <td>{Number(a.comm_rate || 0)}%</td>
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
                            sst_no: a.sst_no || '', website: a.website || '', fax: a.fax || '', comm_rate: a.comm_rate || '',
                          });
                          setShowAgentForm(true);
                        }}
                      >
                        Edit
                      </button>{' '}
                      <button onClick={() => handleToggleAgentActive(a)}>{a.is_active ? 'Deactivate' : 'Activate'}</button>{' '}
                      <button onClick={() => (commissionAgentId === a.id ? setCommissionAgentId(null) : openCommissionEditor(a))}>
                        {commissionAgentId === a.id ? 'Close' : 'Commission Rates'}
                      </button>
                    </>
                  )}
                </td>
              </tr>
              {commissionAgentId === a.id && (
                <tr>
                  <td colSpan={6} style={{ background: '#F5F6FA', padding: 12 }}>
                    <p style={{ fontSize: 12, color: '#5c6070', margin: '0 0 8px' }}>
                      Commission rate for {a.name} — how much of Bare Space (and, if set, non-Booth items too) goes to
                      this agent, split by whether the exhibitor is repeat-from-last-year or new. Add a row for any
                      other split this contract needs.
                    </p>
                    {commissionRows.map((row, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                        <select
                          style={{ ...inputStyle, width: 140 }} value={row.category}
                          onChange={(e) => setCommissionRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, category: e.target.value } : r)))}
                        >
                          <option value="BOOTH">Booth (Bare Space, upgrades)</option>
                          <option value="OTHER">Non-Booth (Sponsorship, Badge, etc.)</option>
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
                  </td>
                </tr>
              )}
              </>
            ))}
            {agents.length === 0 && <tr><td colSpan={6} style={{ fontSize: 13, color: '#5c6070' }}>None set up yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
