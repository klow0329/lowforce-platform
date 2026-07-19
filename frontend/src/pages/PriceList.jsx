import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useEventContext } from '../context/EventContext';

const label = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, marginTop: 12 };
const inputStyle = { display: 'block', width: '100%', padding: 8, boxSizing: 'border-box' };
const fmt = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2 }));

const emptyForm = { id: null, booth_type: '', new_tier_name: '', sales_item_code: '', description: '', category: 'OTHER', default_tax_code_id: '', unit_price_myr: '', unit_price_usd: '' };

export default function PriceList({ user }) {
  const { selectedEventId, events, loading: eventLoading } = useEventContext();
  const isAdmin = user.role_code === 'ADM';

  const [items, setItems] = useState([]);
  const [taxCodes, setTaxCodes] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');

  function load() {
    if (!selectedEventId) return;
    api.listPriceList(selectedEventId).then(({ priceList }) => setItems(priceList));
  }

  useEffect(load, [selectedEventId]);
  useEffect(() => { api.listTaxCodes().then(({ taxCodes }) => setTaxCodes(taxCodes)); }, []);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function startEdit(item) {
    setForm({
      id: item.id,
      booth_type: item.booth_type,
      new_tier_name: '',
      sales_item_code: item.sales_item_code,
      description: item.description || '',
      category: item.category || 'OTHER',
      default_tax_code_id: item.default_tax_code_id || '',
      unit_price_myr: item.unit_price_myr ?? '',
      unit_price_usd: item.unit_price_usd ?? '',
    });
    setShowForm(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    setError('');

    // Tier comes from the dropdown of existing tiers — creating a brand-new
    // tier is a deliberate choice, not a free-text typo.
    const boothType = form.booth_type === '__NEW__' ? form.new_tier_name.trim().toUpperCase() : form.booth_type;
    if (!boothType) {
      setError('Please choose a rate tier (or name the new one).');
      return;
    }

    if (!window.confirm(form.id ? `Save changes to ${form.sales_item_code} (${boothType})?` : `Add ${form.sales_item_code} under ${boothType}?`)) return;

    try {
      const { id, new_tier_name, ...rest } = form;
      const payload = { ...rest, booth_type: boothType };
      if (id) {
        await api.updatePriceItem(id, payload);
      } else {
        await api.createPriceItem({ ...payload, event_id: selectedEventId });
      }
      setForm(emptyForm);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(item) {
    if (!window.confirm(`Delete ${item.sales_item_code} (${item.booth_type})?`)) return;
    setError('');
    try {
      await api.deletePriceItem(item.id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (eventLoading) return <p style={{ maxWidth: 800, margin: '40px auto' }}>Loading...</p>;
  if (!selectedEventId) {
    return <p style={{ maxWidth: 800, margin: '40px auto' }}>No events set up yet — create one in Admin first.</p>;
  }

  const eventName = events.find((ev) => ev.id === selectedEventId)?.name || '';

  // Group rows by rate tier so the table reads like the Excel rate card
  const tiers = [...new Set(items.map((i) => i.booth_type))];

  return (
    <div className="page" style={{ maxWidth: 800, margin: '40px auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Price List — {eventName}</h2>
        {isAdmin && (
          <button onClick={() => { setForm(emptyForm); setShowForm(!showForm); }}>
            {showForm ? 'Cancel' : '+ Add Item'}
          </button>
        )}
      </div>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      {showForm && isAdmin && (
        <form onSubmit={handleSave} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, margin: '16px 0' }}>
          <label style={label}>Rate Tier</label>
          <select style={inputStyle} value={form.booth_type} onChange={(e) => set('booth_type', e.target.value)} required>
            <option value="">— Select a tier —</option>
            {tiers.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
            <option value="__NEW__">+ Create a new tier…</option>
          </select>
          {form.booth_type === '__NEW__' && (
            <>
              <label style={label}>New Tier Name</label>
              <input style={inputStyle} value={form.new_tier_name} onChange={(e) => set('new_tier_name', e.target.value)} required />
            </>
          )}
          <label style={label}>Item Code (e.g. BAS, SSS, ESS, WOP, COR)</label>
          <input style={inputStyle} value={form.sales_item_code} onChange={(e) => set('sales_item_code', e.target.value)} required />
          <label style={label}>Description</label>
          <input style={inputStyle} value={form.description} onChange={(e) => set('description', e.target.value)} />
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={label}>Category</label>
              <select style={inputStyle} value={form.category} onChange={(e) => set('category', e.target.value)}>
                <option value="BOOTH">Booth (counts toward Total Booths)</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={label}>Default Tax Code</label>
              <select style={inputStyle} value={form.default_tax_code_id} onChange={(e) => set('default_tax_code_id', e.target.value)}>
                <option value="">— None —</option>
                {taxCodes.map((tc) => (
                  <option key={tc.id} value={tc.id}>{tc.code} ({tc.rate_pct}%)</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={label}>Unit Price (MYR)</label>
              <input type="number" step="0.01" style={inputStyle} value={form.unit_price_myr} onChange={(e) => set('unit_price_myr', e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={label}>Unit Price (USD)</label>
              <input type="number" step="0.01" style={inputStyle} value={form.unit_price_usd} onChange={(e) => set('unit_price_usd', e.target.value)} />
            </div>
          </div>
          <button type="submit" style={{ padding: '8px 16px', marginTop: 16 }}>
            {form.id ? 'Save Changes' : 'Add Item'}
          </button>
        </form>
      )}

      {tiers.map((tier) => (
        <div key={tier} style={{ marginBottom: 24 }}>
          <h3 style={{ marginBottom: 8 }}>{tier}</h3>
          <table width="100%" cellPadding="6">
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                <th>Code</th>
                <th>Description</th>
                <th style={{ textAlign: 'right' }}>MYR</th>
                <th style={{ textAlign: 'right' }}>USD</th>
                {isAdmin && <th></th>}
              </tr>
            </thead>
            <tbody>
              {items.filter((i) => i.booth_type === tier).map((item) => (
                <tr key={item.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td>
                    {item.sales_item_code}
                    {item.category === 'BOOTH' && (
                      <span style={{ marginLeft: 6, fontSize: 11, color: '#5c6070' }}>[Booth]</span>
                    )}
                  </td>
                  <td>{item.description || '—'}{item.default_tax_code ? ` · ${item.default_tax_code}` : ''}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(item.unit_price_myr)}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(item.unit_price_usd)}</td>
                  {isAdmin && (
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button onClick={() => startEdit(item)}>Edit</button>{' '}
                      <button onClick={() => handleDelete(item)}>Delete</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {items.length === 0 && <p>No price list for this event yet.{isAdmin ? ' Use + Add Item to start.' : ''}</p>}
    </div>
  );
}
