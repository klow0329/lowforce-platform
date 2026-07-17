import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useEventContext } from '../context/EventContext';

const label = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, marginTop: 12 };
const inputStyle = { display: 'block', width: '100%', padding: 8, boxSizing: 'border-box' };

export default function SalesOrderDetail() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { events, selectedEventId } = useEventContext();

  const lockedOpportunityId = searchParams.get('opportunity_id') || '';
  const lockedExhibitorId = searchParams.get('exhibitor_id') || '';
  const lockedExhibitorName = searchParams.get('exhibitor_name') || '';
  const lockedEventId = searchParams.get('event_id') || selectedEventId;
  const lockedBoothSqm = searchParams.get('booth_sqm') || '';
  const lockedBoothType = searchParams.get('booth_type') || '';

  const [form, setForm] = useState({
    exhibitor_id: lockedExhibitorId,
    event_id: lockedEventId,
    opportunity_id: lockedOpportunityId,
    salesperson_id: '',
    contract_type: 'STANDARD',
    contract_date: new Date().toISOString().slice(0, 10),
    total_myr: searchParams.get('estimated_value') || '',
    booking_type: '',
    hall: '',
    booth_no: '',
    dimension: '',
    remarks: '',
    discount_type: '',
    discount_value: '',
  });
  const [exhibitorName, setExhibitorName] = useState(lockedExhibitorName);
  const [exhibitorSearch, setExhibitorSearch] = useState('');
  const [exhibitorResults, setExhibitorResults] = useState([]);
  const [salespeople, setSalespeople] = useState([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [invoices, setInvoices] = useState([]);

  useEffect(() => {
    api.listSalespeople().then(({ salespeople }) => setSalespeople(salespeople));
  }, []);

  useEffect(() => {
    if (isNew) return;
    api.getSalesOrder(id).then(({ salesOrder }) => {
      setForm({
        exhibitor_id: salesOrder.exhibitor_id,
        event_id: salesOrder.event_id,
        opportunity_id: salesOrder.opportunity_id || '',
        salesperson_id: salesOrder.salesperson_id || '',
        contract_type: salesOrder.contract_type,
        contract_date: salesOrder.contract_date || '',
        total_myr: salesOrder.total_myr,
        booking_type: salesOrder.booking_type || '',
        hall: salesOrder.hall || '',
        booth_no: salesOrder.booth_no || '',
        dimension: salesOrder.dimension || '',
        remarks: salesOrder.remarks || '',
        discount_type: salesOrder.discount_type || '',
        discount_value: salesOrder.discount_value ?? '',
      });
      setExhibitorName(salesOrder.company_name);
      setLoading(false);
    });
    api.listInvoices({ sales_order_id: id }).then(({ invoices }) => setInvoices(invoices));
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

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!form.exhibitor_id) {
      setError('Please select an exhibitor.');
      return;
    }

    setSaving(true);
    try {
      if (isNew) {
        const { salesOrder } = await api.createSalesOrder(form);
        navigate(`/sales-orders/${salesOrder.id}`);
      } else {
        await api.updateSalesOrder(id, form);
        navigate('/sales-orders');
      }
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  if (loading) return <p style={{ maxWidth: 600, margin: '40px auto' }}>Loading...</p>;

  return (
    <div style={{ maxWidth: 600, margin: '40px auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>{isNew ? 'New Contract' : 'Edit Contract'}</h2>
        <button type="button" onClick={() => navigate('/sales-orders')}>Back to list</button>
      </div>

      <form onSubmit={handleSubmit}>
        <label style={label}>Exhibitor *</label>
        {lockedExhibitorId || !isNew ? (
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

        {(lockedBoothSqm || lockedBoothType) && (
          <p style={{ fontSize: 13, color: '#5c6070' }}>
            Booth: {lockedBoothType || '—'}, {lockedBoothSqm || '—'} sqm (from linked opportunity)
          </p>
        )}

        <label style={label}>Event</label>
        <select style={inputStyle} value={form.event_id} onChange={(e) => set('event_id', e.target.value)} disabled={!isNew}>
          {events.map((ev) => (
            <option key={ev.id} value={ev.id}>{ev.name}</option>
          ))}
        </select>

        <label style={label}>Contract Type</label>
        <select style={inputStyle} value={form.contract_type} onChange={(e) => set('contract_type', e.target.value)}>
          <option value="STANDARD">Standard</option>
          <option value="COEX">Co-Exhibitor (CoEX)</option>
        </select>

        <label style={label}>Salesperson</label>
        <select style={inputStyle} value={form.salesperson_id} onChange={(e) => set('salesperson_id', e.target.value)}>
          <option value="">— Unassigned —</option>
          {salespeople.map((s) => (
            <option key={s.id} value={s.id}>{s.full_name}</option>
          ))}
        </select>

        <label style={label}>Contract Date</label>
        <input type="date" style={inputStyle} value={form.contract_date} onChange={(e) => set('contract_date', e.target.value)} />

        <label style={label}>Booking Type</label>
        <select style={inputStyle} value={form.booking_type} onChange={(e) => set('booking_type', e.target.value)}>
          <option value="">— Select —</option>
          <option value="PUBLISHED RATE">Published Rate</option>
          <option value="EARLY BIRD">Early Bird</option>
          <option value="ONSITE REBOOKING">Onsite Rebooking</option>
          <option value="CONTRA">Contra</option>
        </select>

        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={label}>Hall</label>
            <input style={inputStyle} value={form.hall} onChange={(e) => set('hall', e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={label}>Booth No</label>
            <input style={inputStyle} value={form.booth_no} onChange={(e) => set('booth_no', e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={label}>Dimension</label>
            <input style={inputStyle} placeholder="e.g. 3m x 3m" value={form.dimension} onChange={(e) => set('dimension', e.target.value)} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={label}>Discount</label>
            <select style={inputStyle} value={form.discount_type} onChange={(e) => set('discount_type', e.target.value)}>
              <option value="">— None —</option>
              <option value="FLAT">Flat amount (MYR)</option>
              <option value="PERCENT">Percentage (%)</option>
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={label}>Discount Value</label>
            <input type="number" step="0.01" style={inputStyle} value={form.discount_value} onChange={(e) => set('discount_value', e.target.value)} disabled={!form.discount_type} />
          </div>
        </div>

        <label style={label}>Total (MYR — after discount)</label>
        <input type="number" step="0.01" style={inputStyle} value={form.total_myr} onChange={(e) => set('total_myr', e.target.value)} />

        <label style={label}>Remarks</label>
        <textarea style={{ ...inputStyle, minHeight: 48 }} value={form.remarks} onChange={(e) => set('remarks', e.target.value)} />

        {error && <p style={{ color: 'red' }}>{error}</p>}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button type="submit" disabled={saving} style={{ padding: '8px 16px' }}>
            {saving ? 'Saving...' : 'Save'}
          </button>
          {!isNew && (
            <>
              <button type="button" onClick={() => navigate(`/sales-orders/${id}/print`)} style={{ padding: '8px 16px' }}>
                View / Print Contract
              </button>
              <button type="button" onClick={() => navigate(`/sales-orders/${id}/proforma`)} style={{ padding: '8px 16px' }}>
                View / Print Proforma
              </button>
            </>
          )}
        </div>
      </form>

      {!isNew && (() => {
        // A contract can be billed in installments (the Excel workflow used
        // 20%/50%/100% milestones) — list every invoice and offer another
        // while an un-invoiced balance remains.
        const totalInvoiced = invoices.reduce((sum, inv) => sum + Number(inv.amount_myr), 0);
        const remaining = Number(form.total_myr || 0) - totalInvoiced;
        const fmtMYR = (n) => `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2 })}`;
        return (
          <div style={{ marginTop: 32 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Invoices — {fmtMYR(totalInvoiced)} of {fmtMYR(form.total_myr || 0)} invoiced</h3>
              {remaining > 0.01 && (
                <button
                  type="button"
                  onClick={() => {
                    const params = new URLSearchParams({
                      sales_order_id: id,
                      exhibitor_name: exhibitorName,
                      total_myr: remaining.toFixed(2),
                    });
                    navigate(`/invoices/new?${params}`);
                  }}
                >
                  {invoices.length === 0 ? 'Generate Invoice' : '+ New Installment Invoice'}
                </button>
              )}
            </div>
            <table width="100%" cellPadding="6">
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                  <th>Invoice No</th>
                  <th>Date</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr
                    key={inv.id}
                    onClick={() => navigate(`/invoices/${inv.id}`)}
                    style={{ borderBottom: '1px solid #eee', cursor: 'pointer' }}
                  >
                    <td>{inv.invoice_no}</td>
                    <td>{inv.invoice_date || '—'}</td>
                    <td>{fmtMYR(inv.amount_myr)}</td>
                  </tr>
                ))}
                {invoices.length === 0 && (
                  <tr><td colSpan={3}>Not invoiced yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        );
      })()}
    </div>
  );
}
