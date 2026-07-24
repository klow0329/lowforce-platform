import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { computeChanges, confirmSave, ChangesBanner, fieldsetStyle } from '../utils/recordForm';

const label = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, marginTop: 12 };
const inputStyle = { display: 'block', width: '100%', padding: 8, boxSizing: 'border-box' };
const fmt = (n) => `RM ${Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// A payment is money received from a customer, not tied to one invoice —
// it gets allocated across whichever of their open invoices it's for (in
// full, in part, or split across several), and anything left unallocated
// is that customer's usable credit. Handles underpayment (partial
// allocation, same as before), overpayment (excess just stays
// unallocated), and an agent's lump sum against many invoices without
// saying which up front (allocate now, or come back and allocate more
// later via addPaymentAllocation).
export default function PaymentDetail() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const exhibitorId = searchParams.get('exhibitor_id') || '';
  const exhibitorName = searchParams.get('exhibitor_name') || '';
  const eventId = searchParams.get('event_id') || '';
  const originInvoiceId = searchParams.get('invoice_id') || '';
  const originBalanceDue = searchParams.get('balance_due') || '';

  const [form, setForm] = useState({
    payment_date: new Date().toISOString().slice(0, 10),
    amount_myr: originBalanceDue,
    payment_method: '',
    bank_ref: '',
  });
  const [openInvoices, setOpenInvoices] = useState([]);
  const [allocations, setAllocations] = useState({}); // invoice_id -> amount string
  const [payment, setPayment] = useState(null); // existing payment (edit mode)
  const [original, setOriginal] = useState(null);
  const [editing, setEditing] = useState(isNew);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [newAllocInvoiceId, setNewAllocInvoiceId] = useState('');
  const [newAllocAmount, setNewAllocAmount] = useState('');

  useEffect(() => {
    if (!isNew) return;
    if (!exhibitorId) return;
    api.listInvoices({ exhibitor_id: exhibitorId }).then(({ invoices }) => {
      const open = invoices.filter((inv) => Number(inv.balance_due) > 0.01);
      setOpenInvoices(open);
      if (originInvoiceId) {
        const originInv = open.find((inv) => inv.id === originInvoiceId);
        if (originInv) {
          setAllocations({ [originInvoiceId]: Math.min(Number(originInv.balance_due), Number(originBalanceDue) || Number(originInv.balance_due)) });
        }
      }
    });
  }, [isNew, exhibitorId, originInvoiceId, originBalanceDue]);

  // Same open-invoices list, fetched again once we know the payment's own
  // customer — feeds the invoice picker in the "allocate more later" form.
  useEffect(() => {
    if (isNew || !payment?.exhibitor_id) return;
    api.listInvoices({ exhibitor_id: payment.exhibitor_id }).then(({ invoices }) => {
      setOpenInvoices(invoices.filter((inv) => Number(inv.balance_due) > 0.01));
    });
  }, [isNew, payment?.exhibitor_id]);

  function loadPayment() {
    if (isNew) return;
    api.getPayment(id).then(({ payment }) => {
      const loaded = {
        payment_date: payment.payment_date || '',
        amount_myr: payment.amount_myr,
        payment_method: payment.payment_method || '',
        bank_ref: payment.bank_ref || '',
      };
      setForm(loaded);
      setOriginal(loaded);
      setPayment(payment);
      setLoading(false);
    });
  }

  useEffect(loadPayment, [id, isNew]);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function setAllocation(invoiceId, value) {
    setAllocations((a) => ({ ...a, [invoiceId]: value }));
  }

  const allocatedTotal = Object.values(allocations).reduce((sum, v) => sum + (Number(v) || 0), 0);
  const unallocated = (Number(form.amount_myr) || 0) - allocatedTotal;

  const changes = computeChanges(original, form);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (isNew) {
      if (!window.confirm(`Record a payment of ${fmt(form.amount_myr)} from ${exhibitorName}?`)) return;
      setSaving(true);
      try {
        const allocList = Object.entries(allocations)
          .filter(([, amt]) => Number(amt) > 0)
          .map(([invoice_id, amt]) => ({ invoice_id, amount_myr: Number(amt) }));
        const { payment } = await api.createPayment({
          exhibitor_id: exhibitorId, event_id: eventId || null,
          ...form, allocations: allocList,
        });
        navigate(`/payments/${payment.id}`);
      } catch (err) {
        setError(err.message);
        setSaving(false);
      }
      return;
    }

    if (!confirmSave(changes, 'payment', isNew)) return;
    setSaving(true);
    try {
      await api.updatePayment(id, form);
      setEditing(false);
      loadPayment();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleAddAllocation(e) {
    e.preventDefault();
    setError('');
    try {
      await api.addPaymentAllocation(id, { invoice_id: newAllocInvoiceId, amount_myr: newAllocAmount });
      setNewAllocInvoiceId('');
      setNewAllocAmount('');
      loadPayment();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRemoveAllocation(allocId) {
    if (!window.confirm('Remove this allocation? The amount goes back to being unallocated credit on this payment.')) return;
    setError('');
    try {
      await api.deletePaymentAllocation(id, allocId);
      loadPayment();
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) return <p style={{ maxWidth: 600, margin: '40px auto' }}>Loading...</p>;

  if (isNew && !exhibitorId) {
    return (
      <div className="page" style={{ maxWidth: 600, margin: '40px auto' }}>
        <h2>Record Payment</h2>
        <p style={{ color: 'red' }}>No customer specified — record a payment from an Invoice or an Exhibitor's screen.</p>
      </div>
    );
  }

  const backHref = isNew
    ? `/exhibitors/${exhibitorId}`
    : payment?.allocations?.length === 1
      ? `/invoices/${payment.allocations[0].invoice_id}`
      : `/exhibitors/${payment?.exhibitor_id || exhibitorId}`;

  return (
    <div className="page" style={{ maxWidth: 600, margin: '40px auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>{isNew ? 'Record Payment' : `Payment ${payment.receipt_no}`}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {!isNew && !editing && <button type="button" onClick={() => setEditing(true)}>Edit</button>}
          <button type="button" onClick={() => navigate(backHref)}>Back</button>
        </div>
      </div>

      {(exhibitorName || payment?.company_name) && (
        <p style={{ fontSize: 13, color: '#5c6070' }}>From {exhibitorName || payment.company_name}</p>
      )}

      <form onSubmit={handleSubmit}>
        <fieldset disabled={!editing} style={fieldsetStyle}>
          <label style={label}>Payment Date</label>
          <input type="date" style={inputStyle} value={form.payment_date} onChange={(e) => set('payment_date', e.target.value)} />

          <label style={label}>Amount Received (MYR)</label>
          <input type="number" step="0.01" style={inputStyle} value={form.amount_myr} onChange={(e) => set('amount_myr', e.target.value)} />

          <label style={label}>Payment Method</label>
          <select style={inputStyle} value={form.payment_method} onChange={(e) => set('payment_method', e.target.value)}>
            <option value="">— Select —</option>
            <option value="Bank Transfer">Bank Transfer</option>
            <option value="Cheque">Cheque</option>
            <option value="Cash">Cash</option>
            <option value="Credit Card">Credit Card</option>
          </select>

          <label style={label}>Bank Reference</label>
          <input style={inputStyle} value={form.bank_ref} onChange={(e) => set('bank_ref', e.target.value)} />
        </fieldset>

        {isNew && (
          <div style={{ marginTop: 20 }}>
            <h3 style={{ marginBottom: 4 }}>Allocate to Invoices</h3>
            <p style={{ fontSize: 12, color: '#5c6070', marginTop: 0 }}>
              Split this payment across any of this customer's open invoices. Leave some unallocated if they haven't
              said which invoices it's for yet — you can allocate the rest later from this payment's own screen.
            </p>
            {openInvoices.length === 0 ? (
              <p style={{ fontSize: 13, color: '#5c6070' }}>No open invoices for this customer.</p>
            ) : (
              <table width="100%" cellPadding="6">
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                    <th>Invoice</th><th style={{ textAlign: 'right' }}>Balance Due</th><th style={{ textAlign: 'right' }}>Allocate</th>
                  </tr>
                </thead>
                <tbody>
                  {openInvoices.map((inv) => (
                    <tr key={inv.id} style={{ borderBottom: '1px solid #eee' }}>
                      <td>{inv.invoice_no}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(inv.balance_due)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <input
                          type="number" step="0.01" style={{ width: 110, textAlign: 'right' }}
                          value={allocations[inv.id] ?? ''}
                          onChange={(e) => setAllocation(inv.id, e.target.value)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 24, fontSize: 13, fontWeight: 600, marginTop: 8 }}>
              <span>Allocated: {fmt(allocatedTotal)}</span>
              <span style={{ color: unallocated < -0.01 ? '#c83c3c' : unallocated > 0.01 ? '#8a6d1a' : 'inherit' }}>
                Unallocated (credit): {fmt(unallocated)}
              </span>
            </div>
            {unallocated < -0.01 && (
              <p style={{ color: 'red', fontSize: 13 }}>Allocations can't add up to more than the amount received.</p>
            )}
          </div>
        )}

        {error && <p style={{ color: 'red' }}>{error}</p>}
        {editing && !isNew && <ChangesBanner changes={changes} />}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          {editing && (
            <button type="submit" disabled={saving || (isNew && unallocated < -0.01)} style={{ padding: '8px 16px' }}>
              {saving ? 'Saving...' : isNew ? 'Record Payment' : 'Save'}
            </button>
          )}
          {!isNew && (
            <button type="button" onClick={() => navigate(`/payments/${id}/print`)} style={{ padding: '8px 16px' }}>
              View / Print Receipt
            </button>
          )}
        </div>
      </form>

      {/* Deliberately OUTSIDE the form above — this section has its own
          independent <form> for adding an allocation, and a <form> nested
          inside another <form> is invalid HTML that browsers handle
          unpredictably (confirmed the hard way: inputs bled across both
          forms' boundaries and submits silently no-op'd). */}
      {!isNew && payment && (
        <div style={{ marginTop: 20 }}>
          <h3 style={{ marginBottom: 4 }}>Allocated to Invoices</h3>
          <table width="100%" cellPadding="6">
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                <th>Invoice</th><th style={{ textAlign: 'right' }}>Amount</th><th></th>
              </tr>
            </thead>
            <tbody>
              {payment.allocations.map((a) => (
                <tr key={a.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td><a href={`/invoices/${a.invoice_id}`} onClick={(e) => { e.preventDefault(); navigate(`/invoices/${a.invoice_id}`); }}>{a.invoice_no}</a></td>
                  <td style={{ textAlign: 'right' }}>{fmt(a.amount_myr)}</td>
                  <td style={{ textAlign: 'right' }}><button type="button" onClick={() => handleRemoveAllocation(a.id)}>Remove</button></td>
                </tr>
              ))}
              {payment.allocations.length === 0 && <tr><td colSpan={3} style={{ fontSize: 13, color: '#5c6070' }}>Not yet allocated to any invoice.</td></tr>}
            </tbody>
          </table>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 24, fontSize: 13, fontWeight: 600, marginTop: 8 }}>
            <span>Allocated: {fmt(payment.allocated_myr)}</span>
            <span style={{ color: payment.unallocated_myr > 0.01 ? '#8a6d1a' : 'inherit' }}>Unallocated (credit): {fmt(payment.unallocated_myr)}</span>
          </div>

          {payment.unallocated_myr > 0.01 && (
            <form onSubmit={handleAddAllocation} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 12, border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={label}>Allocate to Invoice</label>
                <select style={inputStyle} value={newAllocInvoiceId} onChange={(e) => setNewAllocInvoiceId(e.target.value)} required>
                  <option value="">— Select —</option>
                  {openInvoices.map((inv) => (
                    <option key={inv.id} value={inv.id}>{inv.invoice_no} ({fmt(inv.balance_due)} due)</option>
                  ))}
                </select>
              </div>
              <div style={{ width: 120 }}>
                <label style={label}>Amount</label>
                <input type="number" step="0.01" style={inputStyle} value={newAllocAmount} onChange={(e) => setNewAllocAmount(e.target.value)} required />
              </div>
              <button type="submit">Allocate</button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
