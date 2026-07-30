import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useEventContext } from '../context/EventContext';
import { computeChanges, confirmSave, ChangesBanner, fieldsetStyle } from '../utils/recordForm';
import { setUnsavedChanges } from '../utils/unsavedChanges';
import DeleteRecordButton from '../components/DeleteRecordButton';
import EmailDraftPanel from '../components/EmailDraftPanel';

const fmtMYR = (n) => `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtMYR2dp = (n) => `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
  is_repeat_exhibitor: false,
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

// Company/contact/address-type fields are uppercased for consistency with
// how the rest of LowForce presents company data (matches the convention
// BillingTemplate already uses for line-item descriptions).
const UPPERCASE_FIELDS = [
  'company_name', 'company_name_alt', 'address', 'city', 'state',
  'contact1_name', 'contact1_job_title', 'contact2_name', 'contact2_job_title',
  'billing_name', 'billing_address', 'billing_city',
];
const EMAIL_FIELDS = ['contact1_email', 'contact2_email', 'billing_email'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Every text field is trimmed on save — a stray leading/trailing space (
// " XXX" or "XXX ") is a constant source of "why doesn't this match"
// confusion (search, duplicate-detection, exports). Emails are lowercased
// instead of uppercased — the normal convention, and all-caps would just
// look broken.
function normalizeExhibitorPayload(payload) {
  const out = { ...payload };
  for (const key of Object.keys(out)) {
    if (typeof out[key] !== 'string') continue;
    let v = out[key].trim();
    if (UPPERCASE_FIELDS.includes(key)) v = v.toUpperCase();
    else if (EMAIL_FIELDS.includes(key)) v = v.toLowerCase();
    out[key] = v;
  }
  return out;
}

export default function ExhibitorDetail({ user }) {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();

  const { events, selectedEventId } = useEventContext();
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
  const [taxLinkVars, setTaxLinkVars] = useState(null);
  const [opportunities, setOpportunities] = useState([]);
  const [statement, setStatement] = useState(null);

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
    loadStatement();
  }, [id, isNew]);

  function loadStatement() {
    if (isNew) return;
    api.getStatementOfAccount(id).then(setStatement);
  }

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  // Postcode/phone are digits-only, no spaces/dashes/symbols — filtered live
  // rather than validated after the fact, since that's easier to notice.
  // Phone in particular should end up as country-code-first with no leading
  // "+" or "00" (e.g. Malaysia: 60123456789) — that's the format WhatsApp's
  // own click-to-chat links (wa.me/<number>) require, so getting reps to
  // enter it that way here means it's usable for WhatsApp straight away.
  function setDigitsOnly(field, value) {
    setForm((f) => ({ ...f, [field]: value.replace(/\D/g, '') }));
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

  // Warns before the user navigates away (nav bar links, tab close/refresh)
  // with unsaved edits — cleared on unmount so it never leaks onto the next
  // page after a confirmed discard or a successful Save.
  useEffect(() => {
    const isDirty = editing && (isNew ? Boolean(form.company_name) : changes.length > 0);
    setUnsavedChanges(isDirty, 'You have unsaved exhibitor changes that will be lost if you leave. Continue?');
    return () => setUnsavedChanges(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, isNew, changes.length, form.company_name]);

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

    const normalized = normalizeExhibitorPayload(payload);
    for (const field of EMAIL_FIELDS) {
      if (normalized[field] && !EMAIL_RE.test(normalized[field])) {
        setError(`${field.replace(/_/g, ' ')} doesn't look like a valid email address.`);
        setSaving(false);
        return;
      }
    }

    try {
      if (isNew) {
        const { exhibitor } = await api.createExhibitor(normalized);
        navigate(`/exhibitors/${exhibitor.id}`);
      } else {
        await api.updateExhibitor(id, normalized);
        navigate('/exhibitors');
      }
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  // Generates a one-time link (5 days) and opens the Draft Email panel
  // (see EmailDraftPanel.jsx) — LowForce never sends the email itself, and
  // can't reach into Outlook to set your signature/account, so the user
  // opens their own New Email and pastes this in. See
  // taxDetailLinks.controller.js for what the exhibitor sees when they open
  // the link, and Admin > Email Templates for the wording itself.
  async function handleSendTaxDetailLink() {
    setError('');
    try {
      const [{ url, exhibitorName, expiresInDays }, { company }] = await Promise.all([
        api.createTaxDetailLink(id), api.getCompany(),
      ]);
      setTaxLinkVars({
        exhibitor_name: exhibitorName, link: url, expiry_days: String(expiresInDays),
        sender_name: user?.full_name || '', company_name: company?.name || '',
      });
    } catch (err) {
      setError(err.message);
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
      {error && <p style={{ color: 'red', fontWeight: 600 }}>{error}</p>}

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
              <input style={inputStyle} value={form.postcode} onChange={(e) => setDigitsOnly('postcode', e.target.value)} inputMode="numeric" required />
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
              <label style={label}>Co. Reg No.</label>
              <input style={inputStyle} value={form.reg_no} onChange={(e) => set('reg_no', e.target.value)} placeholder="Can be added later" />
            </div>
            <div style={{ flex: 1 }}>
              <label style={label}>TIN No.</label>
              <input style={inputStyle} value={form.tin_no} onChange={(e) => set('tin_no', e.target.value)} placeholder="Can be added later" />
            </div>
            <div style={{ flex: 1 }}>
              <label style={label}>SST No.</label>
              <input style={inputStyle} value={form.sst_no} onChange={(e) => set('sst_no', e.target.value)} placeholder="Can be added later" />
            </div>
          </div>
          {!isNew && form.country_code === 'MY' && (!form.reg_no || !form.tin_no) && (
            <div style={{ background: '#F3E8FF', border: '1px solid #C9A6F5', borderRadius: 8, padding: 12, margin: '8px 0' }}>
              <p style={{ margin: 0, fontSize: 13 }}>
                Reg. No / TIN are still missing — needed before generating a Contract. Send the exhibitor a secure,
                one-time link to fill these in themselves, without needing a LowForce login.
              </p>
              <button type="button" onClick={handleSendTaxDetailLink} style={{ marginTop: 8 }}>Send Tax Detail Link</button>
              {taxLinkVars && (
                <EmailDraftPanel templateKey="TAX_DETAIL_LINK" vars={taxLinkVars} onClose={() => setTaxLinkVars(null)} />
              )}
            </div>
          )}

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

          <label style={{ ...label, fontWeight: 400 }}>
            <input
              type="checkbox"
              checked={form.is_repeat_exhibitor}
              onChange={(e) => set('is_repeat_exhibitor', e.target.checked)}
            />
            {' '}<strong>Repeat Exhibitor (exhibited last year)</strong>
            <span style={{ display: 'block', fontSize: 12, color: '#5c6070', fontWeight: 400, marginLeft: 20 }}>
              Set automatically by importing last year's exhibitor list (Admin) — correct it here if the match missed
              a renamed company. Drives this exhibitor's Agent Commission rate.
            </span>
          </label>
        </div>

        <div style={section}>
          <h3>Contacts</h3>
          <label style={label}>Contact 1 Name</label>
          <input style={inputStyle} value={form.contact1_name} onChange={(e) => set('contact1_name', e.target.value)} />
          <label style={label}>Contact 1 Job Title</label>
          <input style={inputStyle} value={form.contact1_job_title} onChange={(e) => set('contact1_job_title', e.target.value)} />
          <label style={label}>Contact 1 Phone *</label>
          <input style={inputStyle} value={form.contact1_phone} onChange={(e) => setDigitsOnly('contact1_phone', e.target.value)} inputMode="numeric" placeholder="Country code first, e.g. 60123456789" required />
          <label style={label}>Contact 1 Email *</label>
          <input type="email" style={inputStyle} value={form.contact1_email} onChange={(e) => set('contact1_email', e.target.value)} required />

          <label style={label}>Contact 2 Name</label>
          <input style={inputStyle} value={form.contact2_name} onChange={(e) => set('contact2_name', e.target.value)} />
          <label style={label}>Contact 2 Job Title</label>
          <input style={inputStyle} value={form.contact2_job_title} onChange={(e) => set('contact2_job_title', e.target.value)} />
          <label style={label}>Contact 2 Phone</label>
          <input style={inputStyle} value={form.contact2_phone} onChange={(e) => setDigitsOnly('contact2_phone', e.target.value)} inputMode="numeric" placeholder="Country code first, e.g. 60123456789" />
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
                  <input style={inputStyle} value={form.billing_postcode} onChange={(e) => setDigitsOnly('billing_postcode', e.target.value)} inputMode="numeric" required />
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
                  <label style={label}>Billing Co. Reg No.</label>
                  <input style={inputStyle} value={form.billing_reg_no} onChange={(e) => set('billing_reg_no', e.target.value)} placeholder="Can be added later" />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={label}>Billing TIN No.</label>
                  <input style={inputStyle} value={form.billing_tin_no} onChange={(e) => set('billing_tin_no', e.target.value)} placeholder="Can be added later" />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={label}>Billing SST No.</label>
                  <input style={inputStyle} value={form.billing_sst_no} onChange={(e) => set('billing_sst_no', e.target.value)} placeholder="Can be added later" />
                </div>
              </div>
              <label style={label}>Billing Contact No. *</label>
              <input style={inputStyle} value={form.billing_contact_no} onChange={(e) => setDigitsOnly('billing_contact_no', e.target.value)} inputMode="numeric" placeholder="Country code first, e.g. 60123456789" required />
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

        {editing && !isNew && <ChangesBanner changes={changes} />}

        {editing && (
          <button type="submit" disabled={saving} style={{ padding: '8px 16px' }}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        )}
        {!isNew && user?.role_code === 'ADM' && (
          <DeleteRecordButton type="exhibitor" id={id} label="exhibitor" onDeleted={() => navigate('/exhibitors')} />
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
                  <td>{o.total_sqm || '—'}</td>
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

      {!isNew && statement && (
        <div style={{ ...section, marginTop: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h3>Statement of Account</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              {user?.role_code === 'FIN' && (
                <button
                  type="button"
                  onClick={() => {
                    const params = new URLSearchParams({
                      exhibitor_id: id, exhibitor_name: form.company_name, event_id: selectedEventId || '',
                    });
                    navigate(`/payments/new?${params}`);
                  }}
                >
                  Record Payment
                </button>
              )}
              <button type="button" onClick={() => navigate(`/exhibitors/${id}/statement`)}>View / Print Statement</button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, margin: '12px 0' }}>
            <div style={{ flex: 1, border: '1px solid #ddd', borderRadius: 8, padding: 12, background: statement.totalOutstanding > 0.01 ? '#fdecec' : '#fff' }}>
              <div style={{ fontSize: 12, color: '#5c6070' }}>Total Outstanding</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: statement.totalOutstanding > 0.01 ? '#D13434' : 'inherit' }}>{fmtMYR2dp(statement.totalOutstanding)}</div>
            </div>
            {statement.creditBalance > 0.01 && (
              <div style={{ flex: 1, border: '1px solid #ddd', borderRadius: 8, padding: 12, background: '#eafaf1' }}>
                <div style={{ fontSize: 12, color: '#5c6070' }}>Available Credit</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#1A9C5B' }}>{fmtMYR2dp(statement.creditBalance)}</div>
              </div>
            )}
          </div>
          <table width="100%" cellPadding="6">
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                <th>Date</th><th>Description</th>
                <th style={{ textAlign: 'right' }}>Invoiced</th>
                <th style={{ textAlign: 'right' }}>Received</th>
                <th style={{ textAlign: 'right' }}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {statement.activities.map((a) => (
                <tr
                  key={`${a.type}-${a.id}`}
                  style={{ borderBottom: '1px solid #eee', cursor: a.type === 'INVOICE' ? 'pointer' : 'default' }}
                  onClick={() => a.type === 'INVOICE' && navigate(`/invoices/${a.id}`)}
                >
                  <td>{a.date || '—'}</td>
                  <td>{a.label}</td>
                  <td style={{ textAlign: 'right' }}>{a.debit > 0 ? fmtMYR2dp(a.debit) : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{a.credit > 0 ? fmtMYR2dp(a.credit) : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{fmtMYR2dp(a.balance)}</td>
                </tr>
              ))}
              {statement.activities.length === 0 && (
                <tr><td colSpan={5}>No account activity yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
