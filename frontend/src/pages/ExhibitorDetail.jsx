import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useEventContext } from '../context/EventContext';
import { computeChanges, confirmSave, ChangesBanner, fieldsetStyle } from '../utils/recordForm';

const fmtMYR = (n) => `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const emptyForm = {
  company_name: '',
  company_name_alt: '',
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
  billing_postcode: '',
  billing_city: '',
  billing_country_code: '',
  billing_reg_no: '',
  billing_tin_no: '',
  billing_sst_no: '',
  billing_contact_no: '',
  billing_email: '',
  segments: [],
  event_ids: [],
};

const section = { marginBottom: 24 };
const label = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, marginTop: 12 };
const inputStyle = { display: 'block', width: '100%', padding: 8, boxSizing: 'border-box' };

export default function ExhibitorDetail() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();

  const { events } = useEventContext();
  const [form, setForm] = useState(emptyForm);
  const [original, setOriginal] = useState(null);
  const [editing, setEditing] = useState(isNew);
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
      setOriginal(loaded);
      setLoading(false);
    });
    api.listOpportunities({ exhibitor_id: id }).then(({ opportunities }) => setOpportunities(opportunities));
  }, [id, isNew]);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function addSegmentRow() {
    setForm((f) => ({ ...f, segments: [...f.segments, { segment_main_id: '', segment_sub_id: '', remarks: '' }] }));
  }

  function updateSegmentRow(index, field, value) {
    setForm((f) => ({
      ...f,
      segments: f.segments.map((seg, i) => {
        if (i !== index) return seg;
        const next = { ...seg, [field]: value };
        if (field === 'segment_main_id') next.segment_sub_id = ''; // sub belongs to the main
        return next;
      }),
    }));
  }

  function removeSegmentRow(index) {
    setForm((f) => ({ ...f, segments: f.segments.filter((_, i) => i !== index) }));
  }

  function toggleEventParticipation(eventId) {
    setForm((f) => ({
      ...f,
      event_ids: f.event_ids.includes(eventId)
        ? f.event_ids.filter((e) => e !== eventId)
        : [...f.event_ids, eventId],
    }));
  }

  const changes = computeChanges(original, form);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!confirmSave(changes, 'exhibitor', isNew)) return;
    setSaving(true);

    // When "Same as Exhibitor Info" is on, every billing field mirrors the
    // exhibitor's own info at save time.
    const same = form.billing_same_as_company;
    const payload = {
      ...form,
      billing_name: same ? form.company_name : form.billing_name,
      billing_address: same ? form.address : form.billing_address,
      billing_postcode: same ? form.postcode : form.billing_postcode,
      billing_city: same ? form.city : form.billing_city,
      billing_country_code: same ? form.country_code : form.billing_country_code,
      billing_reg_no: same ? form.reg_no : form.billing_reg_no,
      billing_tin_no: same ? form.tin_no : form.billing_tin_no,
      billing_sst_no: same ? form.sst_no : form.billing_sst_no,
      billing_contact_no: same ? form.contact1_phone : form.billing_contact_no,
      billing_email: same ? form.contact1_email : form.billing_email,
      segments: form.segments.filter((s) => s.segment_main_id),
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
    <div className="page" style={{ maxWidth: 700, margin: '40px auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2>{isNew ? 'Add Exhibitor' : editing ? 'Edit Exhibitor' : 'Exhibitor'}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {!isNew && !editing && <button type="button" onClick={() => setEditing(true)}>Edit</button>}
          <button type="button" onClick={() => navigate('/exhibitors')}>Back to list</button>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <fieldset disabled={!editing} style={fieldsetStyle}>
        <div style={section}>
          <h3>Company Info</h3>
          <label style={label}>Exhibitor Name *</label>
          <input
            style={inputStyle}
            value={form.company_name}
            onChange={(e) => set('company_name', e.target.value)}
            required
          />

          <label style={label}>Alt Name</label>
          <input style={inputStyle} value={form.company_name_alt} onChange={(e) => set('company_name_alt', e.target.value)} />

          <label style={label}>Address *</label>
          <textarea style={{ ...inputStyle, minHeight: 48 }} value={form.address} onChange={(e) => set('address', e.target.value)} required />

          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={label}>Postcode *</label>
              <input style={inputStyle} value={form.postcode} onChange={(e) => set('postcode', e.target.value)} required />
            </div>
            <div style={{ flex: 2 }}>
              <label style={label}>City</label>
              <input style={inputStyle} value={form.city} onChange={(e) => set('city', e.target.value)} />
            </div>
            <div style={{ flex: 2 }}>
              <label style={label}>State *</label>
              <input style={inputStyle} value={form.state} onChange={(e) => set('state', e.target.value)} required />
            </div>
          </div>

          <label style={label}>Country *</label>
          <select style={inputStyle} value={form.country_code} onChange={(e) => set('country_code', e.target.value)} required>
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
              <label style={label}>Co. Reg No.{form.country_code === 'MY' ? ' *' : ''}</label>
              <input style={inputStyle} value={form.reg_no} onChange={(e) => set('reg_no', e.target.value)} required={form.country_code === 'MY'} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={label}>TIN No.</label>
              <input style={inputStyle} value={form.tin_no} onChange={(e) => set('tin_no', e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={label}>SST No.{form.country_code === 'MY' ? ' *' : ''}</label>
              <input style={inputStyle} value={form.sst_no} onChange={(e) => set('sst_no', e.target.value)} required={form.country_code === 'MY'} />
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
          <label style={label}>Contact 1 Phone *</label>
          <input style={inputStyle} value={form.contact1_phone} onChange={(e) => set('contact1_phone', e.target.value)} required />
          <label style={label}>Contact 1 Email *</label>
          <input type="email" style={inputStyle} value={form.contact1_email} onChange={(e) => set('contact1_email', e.target.value)} required />

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
            {' '}Same as Exhibitor Info
          </label>

          {!form.billing_same_as_company && (
            <>
              <label style={label}>Billing Name</label>
              <input style={inputStyle} value={form.billing_name} onChange={(e) => set('billing_name', e.target.value)} />
              <label style={label}>Billing Address *</label>
              <textarea
                style={{ ...inputStyle, minHeight: 60 }}
                value={form.billing_address}
                onChange={(e) => set('billing_address', e.target.value)}
                required
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={label}>Billing Postcode *</label>
                  <input style={inputStyle} value={form.billing_postcode} onChange={(e) => set('billing_postcode', e.target.value)} required />
                </div>
                <div style={{ flex: 2 }}>
                  <label style={label}>Billing City</label>
                  <input style={inputStyle} value={form.billing_city} onChange={(e) => set('billing_city', e.target.value)} />
                </div>
              </div>
              <label style={label}>Billing Country *</label>
              <select style={inputStyle} value={form.billing_country_code} onChange={(e) => set('billing_country_code', e.target.value)} required>
                <option value="">— Select —</option>
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </select>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={label}>Billing Co. Reg No.{form.billing_country_code === 'MY' ? ' *' : ''}</label>
                  <input style={inputStyle} value={form.billing_reg_no} onChange={(e) => set('billing_reg_no', e.target.value)} required={form.billing_country_code === 'MY'} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={label}>Billing TIN No.</label>
                  <input style={inputStyle} value={form.billing_tin_no} onChange={(e) => set('billing_tin_no', e.target.value)} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={label}>Billing SST No.{form.billing_country_code === 'MY' ? ' *' : ''}</label>
                  <input style={inputStyle} value={form.billing_sst_no} onChange={(e) => set('billing_sst_no', e.target.value)} required={form.billing_country_code === 'MY'} />
                </div>
              </div>
              <label style={label}>Billing Contact No. *</label>
              <input style={inputStyle} value={form.billing_contact_no} onChange={(e) => set('billing_contact_no', e.target.value)} required />
              <label style={label}>Billing Email *</label>
              <input type="email" style={inputStyle} value={form.billing_email} onChange={(e) => set('billing_email', e.target.value)} required />
            </>
          )}
        </div>

        <div style={section}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3>Segments</h3>
            <button type="button" onClick={addSegmentRow}>+ Add Segment</button>
          </div>
          {form.segments.length === 0 && (
            <p style={{ fontSize: 13, color: '#5c6070' }}>No segments yet — use + Add Segment.</p>
          )}
          {form.segments.map((seg, index) => {
            const group = segmentGroups.find((g) => g.id === seg.segment_main_id);
            return (
              <div key={index} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                <select
                  style={{ ...inputStyle, flex: 2 }}
                  value={seg.segment_main_id}
                  onChange={(e) => updateSegmentRow(index, 'segment_main_id', e.target.value)}
                >
                  <option value="">— Main Category —</option>
                  {segmentGroups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
                <select
                  style={{ ...inputStyle, flex: 2 }}
                  value={seg.segment_sub_id || ''}
                  onChange={(e) => updateSegmentRow(index, 'segment_sub_id', e.target.value)}
                  disabled={!seg.segment_main_id}
                >
                  <option value="">— Subcategory (optional) —</option>
                  {(group?.subSegments || []).map((sub) => (
                    <option key={sub.id} value={sub.id}>{sub.name}</option>
                  ))}
                </select>
                <input
                  style={{ ...inputStyle, flex: 2 }}
                  placeholder="Remarks"
                  value={seg.remarks || ''}
                  onChange={(e) => updateSegmentRow(index, 'remarks', e.target.value)}
                />
                <button type="button" onClick={() => removeSegmentRow(index)}>✕</button>
              </div>
            );
          })}
        </div>

        <div style={section}>
          <h3>Event Participation</h3>
          <p style={{ fontSize: 12, color: '#5c6070', marginTop: 0 }}>
            Which events (and sub-events) this exhibitor takes part in.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {events
              .filter((ev) => !ev.parent_event_id)
              .map((main) => (
                <div key={main.id}>
                  <label style={{ fontSize: 13, fontWeight: 600 }}>
                    <input
                      type="checkbox"
                      checked={form.event_ids.includes(main.id)}
                      onChange={() => toggleEventParticipation(main.id)}
                    />
                    {' '}{main.name}
                  </label>
                  {events.filter((ev) => ev.parent_event_id === main.id).map((sub) => (
                    <label key={sub.id} style={{ fontSize: 13, fontWeight: 400, display: 'block', marginLeft: 24 }}>
                      <input
                        type="checkbox"
                        checked={form.event_ids.includes(sub.id)}
                        onChange={() => toggleEventParticipation(sub.id)}
                      />
                      {' '}{sub.name} <span style={{ color: '#5c6070' }}>(sub-event)</span>
                    </label>
                  ))}
                </div>
              ))}
          </div>
        </div>

        </fieldset>

        {error && <p style={{ color: 'red' }}>{error}</p>}
        {editing && !isNew && <ChangesBanner changes={changes} />}

        {editing && (
          <button type="submit" disabled={saving} style={{ padding: '8px 16px' }}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        )}
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
