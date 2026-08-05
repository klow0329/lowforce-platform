import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useEventContext } from '../context/EventContext';

const label = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, marginTop: 12 };
const inputStyle = { display: 'block', width: '100%', padding: 8, boxSizing: 'border-box' };
const fmt = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2 }));

const emptyForm = {
  id: null, booth_type: '', new_tier_name: '', sales_item_code: '', description: '', category: 'OTHER', default_tax_code_id: '', unit_price_myr: '', unit_price_usd: '',
  is_upgrade_option: false, is_addon_item: false, pricing_mode: 'FIXED', pricing_pct: '', is_wide_row: false, is_primary_base: false,
  is_booth_related: false,
};

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
      is_upgrade_option: !!item.is_upgrade_option,
      is_addon_item: !!item.is_addon_item,
      pricing_mode: item.pricing_mode || 'FIXED',
      pricing_pct: item.pricing_pct ?? '',
      is_wide_row: !!item.is_wide_row,
      is_primary_base: !!item.is_primary_base,
      is_booth_related: !!item.is_booth_related,
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
                <option value="BOOTH">Booth-type (Bare Space, upgrades — for revenue/sqm reporting by item)</option>
                <option value="OTHER">Other (add-ons, services)</option>
              </select>
              <p style={{ fontSize: 11, color: '#5c6070', marginTop: 4 }}>
                This only affects reporting breakdowns. Total Sqm always comes from Bare Space's own qty — Booth-type items like upgrades never add extra sqm on top.
              </p>
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
          <label style={label}>Pricing</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <select style={inputStyle} value={form.pricing_mode} onChange={(e) => set('pricing_mode', e.target.value)}>
                <option value="FIXED">Fixed rate (MYR / USD below)</option>
                <option value="PCT_OF_BAS">% of Bare Space's rate</option>
              </select>
            </div>
            {form.pricing_mode === 'PCT_OF_BAS' && (
              <div style={{ flex: 1 }}>
                <input
                  type="number" step="0.01" min="0" style={inputStyle} placeholder="e.g. 15"
                  value={form.pricing_pct} onChange={(e) => set('pricing_pct', e.target.value)}
                />
              </div>
            )}
          </div>
          {form.pricing_mode === 'PCT_OF_BAS' && (
            <p style={{ fontSize: 12, color: '#5c6070', marginTop: 4 }}>
              This item's rate is computed automatically as {form.pricing_pct || 'X'}% of whatever Bare Space is charged on the same contract — the MYR/USD fields below are ignored.
            </p>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={label}>Unit Price (MYR)</label>
              <input type="number" step="0.01" style={inputStyle} value={form.unit_price_myr} disabled={form.pricing_mode === 'PCT_OF_BAS'} onChange={(e) => set('unit_price_myr', e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={label}>Unit Price (USD)</label>
              <input type="number" step="0.01" style={inputStyle} value={form.unit_price_usd} disabled={form.pricing_mode === 'PCT_OF_BAS'} onChange={(e) => set('unit_price_usd', e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
            <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={form.is_upgrade_option} onChange={(e) => set('is_upgrade_option', e.target.checked)} />
              Offer as a Booth Upgrade option (like Shell Scheme, Enhanced Shell...)
            </label>
            <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={form.is_addon_item} onChange={(e) => set('is_addon_item', e.target.checked)} />
              Show as an add-on line in Billing (like Corner Charge, Loading...)
            </label>
            <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={form.is_wide_row} onChange={(e) => set('is_wide_row', e.target.checked)} />
              Show as a wide text box in Billing (like Sponsorship, Other...)
            </label>
          </div>
          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, marginTop: 12 }}>
            <input type="checkbox" checked={form.is_primary_base} onChange={(e) => set('is_primary_base', e.target.checked)} />
            This is the Primary Booth Base item (like Bare Space) — drives Total Sqm system-wide, only one per event
          </label>
          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
            <input type="checkbox" checked={form.is_booth_related} onChange={(e) => set('is_booth_related', e.target.checked)} />
            Booth-related item (like Corner Charge, Loading...) — its Qty in Billing is locked and comes only from marking booths with it on the Floor Plan, not typed manually
          </label>
          {form.is_primary_base && (
            <p style={{ fontSize: 11, color: '#5c6070', marginTop: 4 }}>
              Only one item code can be the Primary Base for this event. Saving this will unset it from any other item and apply it to <strong>{form.sales_item_code || 'this code'}</strong> across every rate tier.
            </p>
          )}
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
                    {item.is_primary_base && (
                      <span style={{ marginLeft: 6, fontSize: 11, color: '#1E7B34', fontWeight: 600 }}>[Primary Base]</span>
                    )}
                    {item.category === 'BOOTH' && (
                      <span style={{ marginLeft: 6, fontSize: 11, color: '#5c6070' }}>[Booth]</span>
                    )}
                    {item.is_upgrade_option && (
                      <span style={{ marginLeft: 6, fontSize: 11, color: '#5c6070' }}>[Upgrade]</span>
                    )}
                    {item.is_addon_item && (
                      <span style={{ marginLeft: 6, fontSize: 11, color: '#5c6070' }}>
                        [Add-on{item.pricing_mode === 'PCT_OF_BAS' ? `, ${item.pricing_pct || 0}% of BAS` : ''}]
                      </span>
                    )}
                    {item.is_wide_row && (
                      <span style={{ marginLeft: 6, fontSize: 11, color: '#5c6070' }}>[Wide box]</span>
                    )}
                    {item.is_booth_related && (
                      <span style={{ marginLeft: 6, fontSize: 11, color: '#5c6070' }}>[Booth-related — Qty locked]</span>
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

      {/* 'ALL TIERS' is a per-item wildcard (Badge/Loading/etc. price the
          same regardless of tier), not itself a bookable tier a credit
          term's default could sensibly point at. */}
      <CreditTermsSection selectedEventId={selectedEventId} isAdmin={isAdmin} tiers={tiers.filter((t) => t !== 'ALL TIERS')} />
    </div>
  );
}

const BASIS_LABELS = {
  FIXED_DATE: 'Fixed date',
  DAYS_AFTER_SIGNING: 'Days after signing',
  WEEKS_AFTER_SIGNING: 'Weeks after signing',
  MONTHS_AFTER_SIGNING: 'Months after signing',
  DAYS_BEFORE_EVENT: 'Days before event',
  WEEKS_BEFORE_EVENT: 'Weeks before event',
  MONTHS_BEFORE_EVENT: 'Months before event',
};
const emptyLine = { pct: '', basis_type: 'DAYS_AFTER_SIGNING', basis_date: '', basis_value: '', description: '' };
const emptyTermForm = { id: null, code: '', name: '', default_for_tier: '', is_active: true, lines: [{ ...emptyLine }] };

const BASIS_UNIT = {
  DAYS_AFTER_SIGNING: 'day(s)', WEEKS_AFTER_SIGNING: 'week(s)', MONTHS_AFTER_SIGNING: 'month(s)',
  DAYS_BEFORE_EVENT: 'day(s)', WEEKS_BEFORE_EVENT: 'week(s)', MONTHS_BEFORE_EVENT: 'month(s)',
};

function describeLine(l) {
  const pct = `${l.pct}%`;
  if (l.basis_type === 'FIXED_DATE') return `${pct} due ${l.basis_date || '(no date set)'}`;
  const unit = BASIS_UNIT[l.basis_type] || 'unit(s)';
  const relativeTo = l.basis_type.endsWith('_BEFORE_EVENT') ? 'before event' : 'after signing';
  return `${pct} due ${l.basis_value || 0} ${unit} ${relativeTo}`;
}

// Credit Terms — named, reusable installment schedules (e.g. "20/30/50",
// "50/50", "Full payment on invoice") that Sales picks (or gets defaulted
// by Tier) on Opportunity/Contract, and which pre-fill the Generate
// Scheduled Invoices split screen instead of a blank form every time.
// Lives on this same page as Price List since both are per-event admin
// configuration a Sales rep never edits, only selects from.
function CreditTermsSection({ selectedEventId, isAdmin, tiers }) {
  const [terms, setTerms] = useState([]);
  const [form, setForm] = useState(emptyTermForm);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');

  function load() {
    if (!selectedEventId) return;
    api.listCreditTerms(selectedEventId).then(({ creditTerms }) => setTerms(creditTerms));
  }
  useEffect(load, [selectedEventId]);

  function setLine(i, field, value) {
    setForm((f) => ({ ...f, lines: f.lines.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)) }));
  }
  function addLine() {
    setForm((f) => ({ ...f, lines: [...f.lines, { ...emptyLine }] }));
  }
  function removeLine(i) {
    setForm((f) => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }));
  }

  function startEdit(term) {
    setForm({
      id: term.id, code: term.code, name: term.name, default_for_tier: term.default_for_tier || '', is_active: term.is_active,
      lines: term.lines.map((l) => ({
        pct: l.pct, basis_type: l.basis_type, basis_date: l.basis_date || '', basis_value: l.basis_value ?? '', description: l.description || '',
      })),
    });
    setShowForm(true);
  }

  const totalPct = form.lines.reduce((sum, l) => sum + (Number(l.pct) || 0), 0);

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    if (Math.abs(totalPct - 100) > 0.01) {
      setError(`Installment percentages must add up to exactly 100% (currently ${totalPct}%).`);
      return;
    }
    if (!window.confirm(form.id ? `Save changes to ${form.code}?` : `Add credit term ${form.code}?`)) return;
    try {
      const { id, ...rest } = form;
      if (id) await api.updateCreditTerm(id, rest);
      else await api.createCreditTerm({ ...rest, event_id: selectedEventId });
      setForm(emptyTermForm);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(term) {
    if (!window.confirm(`Delete credit term ${term.code}?`)) return;
    try {
      await api.deleteCreditTerm(term.id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div style={{ marginTop: 40, paddingTop: 24, borderTop: '2px solid #e2e5ec' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Credit Terms</h2>
        {isAdmin && (
          <button onClick={() => { setForm(emptyTermForm); setShowForm(!showForm); }}>
            {showForm ? 'Cancel' : '+ Add Credit Term'}
          </button>
        )}
      </div>
      <p style={{ fontSize: 13, color: '#5c6070' }}>
        Installment payment schedules Sales can select on an Opportunity/Contract (defaulted by Tier) — these pre-fill Generate Scheduled Invoices splits and drive AR Aging due dates.
      </p>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      {showForm && isAdmin && (
        <form onSubmit={handleSave} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, margin: '16px 0' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={label}>Code</label>
              <input style={inputStyle} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required disabled={!!form.id} />
            </div>
            <div style={{ flex: 2 }}>
              <label style={label}>Name</label>
              <input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div style={{ flex: 1 }}>
              <label style={label}>Default for Tier</label>
              <select style={inputStyle} value={form.default_for_tier} onChange={(e) => setForm({ ...form, default_for_tier: e.target.value })}>
                <option value="">— None —</option>
                {tiers.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          <label style={{ ...label, marginTop: 16 }}>Installments</label>
          {form.lines.map((l, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 8 }}>
              <div style={{ width: 80 }}>
                <input type="number" step="0.01" min="0" placeholder="%" style={inputStyle} value={l.pct} onChange={(e) => setLine(i, 'pct', e.target.value)} required />
              </div>
              <div style={{ flex: 1 }}>
                <select style={inputStyle} value={l.basis_type} onChange={(e) => setLine(i, 'basis_type', e.target.value)}>
                  {Object.entries(BASIS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              {l.basis_type === 'FIXED_DATE' ? (
                <div style={{ flex: 1 }}>
                  <input type="date" style={inputStyle} value={l.basis_date} onChange={(e) => setLine(i, 'basis_date', e.target.value)} required />
                </div>
              ) : (
                <div style={{ flex: 1 }}>
                  <input type="number" min="0" placeholder="e.g. 30" style={inputStyle} value={l.basis_value} onChange={(e) => setLine(i, 'basis_value', e.target.value)} required />
                </div>
              )}
              <div style={{ flex: 1.5 }}>
                <input placeholder="Description (optional)" style={inputStyle} value={l.description} onChange={(e) => setLine(i, 'description', e.target.value)} />
              </div>
              <button type="button" onClick={() => removeLine(i)} disabled={form.lines.length === 1}>Remove</button>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
            <button type="button" onClick={addLine}>+ Add Installment</button>
            <span style={{ fontSize: 13, fontWeight: 600, color: Math.abs(totalPct - 100) > 0.01 ? '#c83c3c' : '#1E7B34' }}>
              Total: {totalPct}%
            </span>
          </div>

          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, marginTop: 16 }}>
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
            Active (selectable on new Opportunities/Contracts)
          </label>

          <button type="submit" style={{ padding: '8px 16px', marginTop: 16 }}>
            {form.id ? 'Save Changes' : 'Add Credit Term'}
          </button>
        </form>
      )}

      <table width="100%" cellPadding="6">
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
            <th>Code</th><th>Name</th><th>Default Tier</th><th>Installments</th>{isAdmin && <th></th>}
          </tr>
        </thead>
        <tbody>
          {terms.map((t) => (
            <tr key={t.id} style={{ borderBottom: '1px solid #eee' }}>
              <td>{t.code}{!t.is_active && <span style={{ marginLeft: 6, fontSize: 11, color: '#c83c3c' }}>[Inactive]</span>}</td>
              <td>{t.name}</td>
              <td>{t.default_for_tier || '—'}</td>
              <td style={{ fontSize: 12 }}>{t.lines.map(describeLine).join('; ')}</td>
              {isAdmin && (
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button onClick={() => startEdit(t)}>Edit</button>{' '}
                  <button onClick={() => handleDelete(t)}>Delete</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {terms.length === 0 && <p>No credit terms for this event yet.{isAdmin ? ' Use + Add Credit Term to start.' : ''}</p>}
    </div>
  );
}
