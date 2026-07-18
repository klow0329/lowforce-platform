import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useEventContext } from '../context/EventContext';
import { computeChanges, confirmSave, ChangesBanner, fieldsetStyle } from '../utils/recordForm';

const label = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, marginTop: 12 };
const inputStyle = { display: 'block', width: '100%', padding: 8, boxSizing: 'border-box' };

export default function OpportunityDetail() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { events, selectedEventId } = useEventContext();

  const lockedExhibitorId = searchParams.get('exhibitor_id') || '';
  const lockedExhibitorName = searchParams.get('exhibitor_name') || '';

  const [form, setForm] = useState({
    exhibitor_id: lockedExhibitorId,
    event_id: selectedEventId,
    salesperson_id: '',
    stage_id: '',
    booth_sqm: '',
    booth_type: '',
    estimated_value_myr: '',
    next_follow_up_date: '',
    remarks: '',
  });
  const [exhibitorName, setExhibitorName] = useState(lockedExhibitorName);
  const [exhibitorSearch, setExhibitorSearch] = useState('');
  const [exhibitorResults, setExhibitorResults] = useState([]);

  const [stages, setStages] = useState([]);
  const [salespeople, setSalespeople] = useState([]);
  const [original, setOriginal] = useState(null);
  const [editing, setEditing] = useState(isNew);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.listStages(), api.listSalespeople()]).then(([st, sp]) => {
      setStages(st.stages);
      setSalespeople(sp.salespeople);
      setForm((f) => (f.stage_id ? f : { ...f, stage_id: st.stages[0]?.id || '' }));
    });
  }, []);

  useEffect(() => {
    if (isNew) return;
    api.getOpportunity(id).then(({ opportunity }) => {
      const loaded = {
        exhibitor_id: opportunity.exhibitor_id,
        event_id: opportunity.event_id,
        salesperson_id: opportunity.salesperson_id || '',
        stage_id: opportunity.stage_id,
        booth_sqm: opportunity.booth_sqm ?? '',
        booth_type: opportunity.booth_type || '',
        estimated_value_myr: opportunity.estimated_value_myr ?? '',
        next_follow_up_date: opportunity.next_follow_up_date || '',
        remarks: opportunity.remarks || '',
      };
      setForm(loaded);
      setOriginal(loaded);
      setExhibitorName(opportunity.exhibitor_name);
      setLoading(false);
    });
  }, [id, isNew]);

  useEffect(() => {
    if (!exhibitorSearch) {
      setExhibitorResults([]);
      return;
    }
    const t = setTimeout(() => {
      api.listExhibitors(exhibitorSearch).then(({ exhibitors }) => setExhibitorResults(exhibitors));
    }, 250);
    return () => clearTimeout(t);
  }, [exhibitorSearch]);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function selectExhibitor(ex) {
    set('exhibitor_id', ex.id);
    setExhibitorName(ex.company_name);
    setExhibitorSearch('');
    setExhibitorResults([]);
  }

  const changes = computeChanges(original, form);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!form.exhibitor_id) {
      setError('Please select an exhibitor.');
      return;
    }

    if (!confirmSave(changes, 'opportunity', isNew)) return;
    setSaving(true);
    try {
      if (isNew) {
        await api.createOpportunity(form);
      } else {
        await api.updateOpportunity(id, form);
      }
      navigate('/opportunities');
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  if (loading) return <p style={{ maxWidth: 600, margin: '40px auto' }}>Loading...</p>;

  return (
    <div style={{ maxWidth: 600, margin: '40px auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>{isNew ? 'Add Opportunity' : editing ? 'Edit Opportunity' : 'Opportunity'}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {!isNew && !editing && <button type="button" onClick={() => setEditing(true)}>Edit</button>}
          <button type="button" onClick={() => navigate('/opportunities')}>Back to list</button>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <fieldset disabled={!editing} style={fieldsetStyle}>
        <label style={label}>Exhibitor *</label>
        {lockedExhibitorId ? (
          <div style={{ padding: 8, background: '#F5F6FA', borderRadius: 4 }}>{exhibitorName}</div>
        ) : form.exhibitor_id ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 8, background: '#F5F6FA', borderRadius: 4 }}>
            <span>{exhibitorName}</span>
            <button type="button" onClick={() => { set('exhibitor_id', ''); setExhibitorName(''); }}>Change</button>
          </div>
        ) : (
          <div>
            <input
              style={inputStyle}
              placeholder="Search company name..."
              value={exhibitorSearch}
              onChange={(e) => setExhibitorSearch(e.target.value)}
            />
            {exhibitorResults.length > 0 && (
              <div style={{ border: '1px solid #ddd', borderTop: 'none', maxHeight: 160, overflowY: 'auto' }}>
                {exhibitorResults.map((ex) => (
                  <div
                    key={ex.id}
                    onClick={() => selectExhibitor(ex)}
                    style={{ padding: 8, cursor: 'pointer', borderBottom: '1px solid #eee' }}
                  >
                    {ex.company_name}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <label style={label}>Event (or sub-event)</label>
        <select style={inputStyle} value={form.event_id} onChange={(e) => set('event_id', e.target.value)}>
          {events
            .filter((ev) => !ev.parent_event_id)
            .flatMap((main) => [main, ...events.filter((ev) => ev.parent_event_id === main.id)])
            .map((ev) => (
              <option key={ev.id} value={ev.id}>{ev.parent_event_id ? `— ${ev.name}` : ev.name}</option>
            ))}
        </select>

        <label style={label}>Stage</label>
        <select style={inputStyle} value={form.stage_id} onChange={(e) => set('stage_id', e.target.value)}>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>

        <label style={label}>Salesperson</label>
        <select style={inputStyle} value={form.salesperson_id} onChange={(e) => set('salesperson_id', e.target.value)}>
          <option value="">— Unassigned —</option>
          {salespeople.map((s) => (
            <option key={s.id} value={s.id}>{s.full_name}</option>
          ))}
        </select>

        <label style={label}>Booth Type</label>
        <input style={inputStyle} value={form.booth_type} onChange={(e) => set('booth_type', e.target.value)} />

        <label style={label}>Booth Sqm</label>
        <input type="number" step="0.01" style={inputStyle} value={form.booth_sqm} onChange={(e) => set('booth_sqm', e.target.value)} />

        <label style={label}>Estimated Value (MYR)</label>
        <input type="number" step="0.01" style={inputStyle} value={form.estimated_value_myr} onChange={(e) => set('estimated_value_myr', e.target.value)} />

        <label style={label}>Next Follow-up Date</label>
        <input type="date" style={inputStyle} value={form.next_follow_up_date} onChange={(e) => set('next_follow_up_date', e.target.value)} />

        <label style={label}>Remarks</label>
        <textarea style={{ ...inputStyle, minHeight: 48 }} value={form.remarks} onChange={(e) => set('remarks', e.target.value)} />
        </fieldset>

        {error && <p style={{ color: 'red' }}>{error}</p>}
        {editing && !isNew && <ChangesBanner changes={changes} />}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          {editing && (
            <button type="submit" disabled={saving} style={{ padding: '8px 16px' }}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          )}
          {!isNew && (
            <button
              type="button"
              onClick={() => {
                const params = new URLSearchParams({
                  opportunity_id: id,
                  exhibitor_id: form.exhibitor_id,
                  exhibitor_name: exhibitorName,
                  event_id: form.event_id,
                  estimated_value: form.estimated_value_myr,
                  booth_sqm: form.booth_sqm,
                  booth_type: form.booth_type,
                });
                navigate(`/sales-orders/new?${params}`);
              }}
              style={{ padding: '8px 16px' }}
            >
              Generate Contract
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
