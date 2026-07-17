import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';

const fmtMYR = (n) => `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const emptyForm = {
  company_name: '',
  company_name_chinese: '',
  country_code: '',
  agent_id: '',
  salesperson_id: '',
  address: '',
  postcode: '',
  city: '',
  state: '',
  reg_no: '',
  tin_no: '',
  sst_no: '',
  website: '',
  fax: '',
  halal_certified: false,
  contact1_name: '',
  contact1_job_title: '',
  contact1_phone: '',
  contact1_email: '',
  contact2_name: '',
  contact2_job_title: '',
  contact2_phone: '',
  contact2_email: '',
  billing_same_as_company: true,
  billing_name: '',
  billing_address: '',
  billing_country_code: '',
  billing_email: '',
  segment_sub_ids: [],
};

const section = { marginBottom: 24 };
const label = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, marginTop: 12 };
const inputStyle = { display: 'block', width: '100%', padding: 8, boxSizing: 'border-box' };

export default function ExhibitorDetail() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();

  const [form, setForm] = useState(emptyForm);
  const [countries, setCountries] = useState([]);
  const [agents, setAgents] = useState([]);
  const [salespeople, setSalespeople] = useState([]);
  const [segmentGroups, setSegmentGroups] = useState([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [opportunities, setOpportunities] = useState([]);

  useEffect(() => {
    Promise.all([api.listCountries(), api.listAgents(), api.listSalespeople(), api.listSegments()]).then(
      ([c, a, s, seg]) => {
        setCountries(c.countries);
        setAgents(a.agents);
        setSalespeople(s.salespeople);
        setSegmentGroups(seg.segments);
      }
    );
  }, []);

  useEffect(() => {
    if (isNew) return;
    api.getExhibitor(id).then(({ exhibitor }) => {
      const loaded = { ...emptyForm };
      for (const key of Object.keys(emptyForm)) {
        if (exhibitor[key] !== null && exhibitor[key] !== undefined) loaded[key] = exhibitor[key];
      }
      setForm(loaded);
      setLoading(false);
    });
    api.listOpportunities({ exhibitor_id: id }).then(({ opportunities }) => setOpportunities(opportunities));
  }, [id, isNew]);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function toggleSegment(segmentSubId) {
    setForm((f) => ({
      ...f,
      segment_sub_ids: f.segment_sub_ids.includes(segmentSubId)
        ? f.segment_sub_ids.filter((s) => s !== segmentSubId)
        : [...f.segment_sub_ids, segmentSubId],
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);

    // When "same as company" is on, billing fields mirror the company's own
    // info at save time — billing_address has no company-level equivalent
    // to mirror, so it's always entered directly.
    const payload = {
      ...form,
      billing_name: form.billing_same_as_company ? form.company_name : form.billing_name,
      billing_country_code: form.billing_same_as_company ? form.country_code : form.billing_country_code,
      billing_email: form.billing_same_as_company ? form.contact1_email : form.billing_email,
    };

    try {
      if (isNew) {
        const { exhibitor } = await api.createExhibitor(payload);
        navigate(`/exhibitors/${exhibitor.id}`);
      } else {
        await api.updateExhibitor(id, payload);
        navigate('/exhibitors');
      }
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  if (loading) return <p style={{ maxWidth: 700, margin: '40px auto' }}>Loading...</p>;

  return (
    <div style={{ maxWidth: 700, margin: '40px auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>{isNew ? 'Add Exhibitor' : 'Edit Exhibitor'}</h2>
        <button type="button" onClick={() => navigate('/exhibitors')}>Back to list</button>
      </div>

      <form onSubmit={handleSubmit}>
        <div style={section}>
          <h3>Company Info</h3>
          <label style={label}>Company Name *</label>
          <input
            style={inputStyle}
            value={form.company_name}
            onChange={(e) => set('company_name', e.target.value)}
            required
          />

          <label style={label}>Company Name (Chinese)</label>
          <input style={inputStyle} value={form.company_name_chinese} onChange={(e) => set('company_name_chinese', e.target.value)} />

          <label style={label}>Address</label>
          <textarea style={{ ...inputStyle, minHeight: 48 }} value={form.address} onChange={(e) => set('address', e.target.value)} />

          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={label}>Postcode</label>
              <input style={inputStyle} value={form.postcode} onChange={(e) => set('postcode', e.target.value)} />
            </div>
            <div style={{ flex: 2 }}>
              <label style={label}>City</label>
              <input style={inputStyle} value={form.city} onChange={(e) => set('city', e.target.value)} />
            </div>
            <div style={{ flex: 2 }}>
              <label style={label}>State</label>
              <input style={inputStyle} value={form.state} onChange={(e) => set('state', e.target.value)} />
            </div>
          </div>

          <label style={label}>Country</label>
          <select style={inputStyle} value={form.country_code} onChange={(e) => set('country_code', e.target.value)}>
            <option value="">— Select —</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>{c.name}</option>
            ))}
          </select>

          <label style={label}>Agent</label>
          <select style={inputStyle} value={form.agent_id} onChange={(e) => set('agent_id', e.target.value)}>
            <option value="">— None —</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>

          <label style={label}>Salesperson</label>
          <select style={inputStyle} value={form.salesperson_id} onChange={(e) => set('salesperson_id', e.target.value)}>
            <option value="">— Unassigned —</option>
            {salespeople.map((s) => (
              <option key={s.id} value={s.id}>{s.full_name}</option>
            ))}
          </select>

          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={label}>Co. Reg No.</label>
              <input style={inputStyle} value={form.reg_no} onChange={(e) => set('reg_no', e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={label}>TIN No.</label>
              <input style={inputStyle} value={form.tin_no} onChange={(e) => set('tin_no', e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={label}>SST No.</label>
              <input style={inputStyle} value={form.sst_no} onChange={(e) => set('sst_no', e.target.value)} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 2 }}>
              <label style={label}>Website</label>
              <input style={inputStyle} value={form.website} onChange={(e) => set('website', e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={label}>Fax</label>
              <input style={inputStyle} value={form.fax} onChange={(e) => set('fax', e.target.value)} />
            </div>
          </div>

          <label style={{ ...label, fontWeight: 400 }}>
            <input
              type="checkbox"
              checked={form.halal_certified}
              onChange={(e) => set('halal_certified', e.target.checked)}
            />
            {' '}<strong>Halal Certified</strong>
          </label>
        </div>

        <div style={section}>
          <h3>Contacts</h3>
          <label style={label}>Contact 1 Name</label>
          <input style={inputStyle} value={form.contact1_name} onChange={(e) => set('contact1_name', e.target.value)} />
          <label style={label}>Contact 1 Job Title</label>
          <input style={inputStyle} value={form.contact1_job_title} onChange={(e) => set('contact1_job_title', e.target.value)} />
          <label style={label}>Contact 1 Phone</label>
          <input style={inputStyle} value={form.contact1_phone} onChange={(e) => set('contact1_phone', e.target.value)} />
          <label style={label}>Contact 1 Email</label>
          <input type="email" style={inputStyle} value={form.contact1_email} onChange={(e) => set('contact1_email', e.target.value)} />

          <label style={label}>Contact 2 Name</label>
          <input style={inputStyle} value={form.contact2_name} onChange={(e) => set('contact2_name', e.target.value)} />
          <label style={label}>Contact 2 Job Title</label>
          <input style={inputStyle} value={form.contact2_job_title} onChange={(e) => set('contact2_job_title', e.target.value)} />
          <label style={label}>Contact 2 Phone</label>
          <input style={inputStyle} value={form.contact2_phone} onChange={(e) => set('contact2_phone', e.target.value)} />
          <label style={label}>Contact 2 Email</label>
          <input type="email" style={inputStyle} value={form.contact2_email} onChange={(e) => set('contact2_email', e.target.value)} />
        </div>

        <div style={section}>
          <h3>Billing</h3>
          <label>
            <input
              type="checkbox"
              checked={form.billing_same_as_company}
              onChange={(e) => set('billing_same_as_company', e.target.checked)}
            />
            {' '}Same as company info
          </label>

          {!form.billing_same_as_company && (
            <>
              <label style={label}>Billing Name</label>
              <input style={inputStyle} value={form.billing_name} onChange={(e) => set('billing_name', e.target.value)} />
              <label style={label}>Billing Country</label>
              <select style={inputStyle} value={form.billing_country_code} onChange={(e) => set('billing_country_code', e.target.value)}>
                <option value="">— Select —</option>
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </select>
              <label style={label}>Billing Email</label>
              <input type="email" style={inputStyle} value={form.billing_email} onChange={(e) => set('billing_email', e.target.value)} />
            </>
          )}

          <label style={label}>Billing Address</label>
          <textarea
            style={{ ...inputStyle, minHeight: 60 }}
            value={form.billing_address}
            onChange={(e) => set('billing_address', e.target.value)}
          />
        </div>

        <div style={section}>
          <h3>Segments</h3>
          {segmentGroups.map((group) => (
            <div key={group.id} style={{ marginBottom: 12 }}>
              <strong style={{ fontSize: 13 }}>{group.name}</strong>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 4 }}>
                {group.subSegments.map((sub) => (
                  <label key={sub.id} style={{ fontSize: 13, fontWeight: 400 }}>
                    <input
                      type="checkbox"
                      checked={form.segment_sub_ids.includes(sub.id)}
                      onChange={() => toggleSegment(sub.id)}
                    />
                    {' '}{sub.name}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        {error && <p style={{ color: 'red' }}>{error}</p>}

        <button type="submit" disabled={saving} style={{ padding: '8px 16px' }}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </form>

      {!isNew && (
        <div style={{ ...section, marginTop: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3>Opportunities</h3>
            <button
              type="button"
              onClick={() => navigate(`/opportunities/new?exhibitor_id=${id}&exhibitor_name=${encodeURIComponent(form.company_name)}`)}
            >
              + Add Opportunity
            </button>
          </div>
          <table width="100%" cellPadding="6">
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                <th>Event</th>
                <th>Stage</th>
                <th>Sqm</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {opportunities.map((o) => (
                <tr
                  key={o.id}
                  onClick={() => navigate(`/opportunities/${o.id}`)}
                  style={{ borderBottom: '1px solid #eee', cursor: 'pointer' }}
                >
                  <td>{o.event_name}</td>
                  <td style={{ color: o.is_won ? '#1A9C5B' : o.is_lost ? '#D13434' : 'inherit' }}>{o.stage_name}</td>
                  <td>{o.booth_sqm || '—'}</td>
                  <td>{fmtMYR(o.estimated_value_myr)}</td>
                </tr>
              ))}
              {opportunities.length === 0 && (
                <tr><td colSpan={4}>No opportunities yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
