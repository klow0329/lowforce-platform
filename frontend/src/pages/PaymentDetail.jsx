import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { computeChanges, confirmSave, ChangesBanner, fieldsetStyle } from '../utils/recordForm';

const label = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, marginTop: 12 };
const inputStyle = { display: 'block', width: '100%', padding: 8, boxSizing: 'border-box' };

export default function PaymentDetail() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const invoiceId = searchParams.get('invoice_id') || '';
  const invoiceNo = searchParams.get('invoice_no') || '';
  const balanceDue = searchParams.get('balance_due') || '';

  const [form, setForm] = useState({
    invoice_id: invoiceId,
    payment_date: new Date().toISOString().slice(0, 10),
    amount_myr: balanceDue,
    payment_method: '',
    bank_ref: '',
  });
  const [receiptNo, setReceiptNo] = useState('');
  const [original, setOriginal] = useState(null);
  const [editing, setEditing] = useState(isNew);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isNew) return;
    api.getPayment(id).then(({ payment }) => {
      const loaded = {
        invoice_id: payment.invoice_id,
        payment_date: payment.payment_date || '',
        amount_myr: payment.amount_myr,
        payment_method: payment.payment_method || '',
        bank_ref: payment.bank_ref || '',
      };
      setForm(loaded);
      setOriginal(loaded);
      setReceiptNo(payment.receipt_no);
      setLoading(false);
    });
  }, [id, isNew]);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const changes = computeChanges(original, form);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!confirmSave(changes, 'payment', isNew)) return;
    setSaving(true);
    try {
      if (isNew) {
        const { payment } = await api.createPayment(form);
        navigate(`/payments/${payment.id}`);
      } else {
        await api.updatePayment(id, form);
        navigate(`/invoices/${form.invoice_id}`);
      }
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  if (loading) return <p style={{ maxWidth: 500, margin: '40px auto' }}>Loading...</p>;

  return (
    <div className="page" style={{ maxWidth: 500, margin: '40px auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>{isNew ? 'Record Payment' : `Payment ${receiptNo}`}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {!isNew && !editing && <button type="button" onClick={() => setEditing(true)}>Edit</button>}
          <button type="button" onClick={() => navigate(`/invoices/${form.invoice_id}`)}>Back to invoice</button>
        </div>
      </div>

      {invoiceNo && (
        <p style={{ fontSize: 13, color: '#5c6070' }}>Against Invoice {invoiceNo}</p>
      )}

      <form onSubmit={handleSubmit}>
        <fieldset disabled={!editing} style={fieldsetStyle}>
        <label style={label}>Payment Date</label>
        <input type="date" style={inputStyle} value={form.payment_date} onChange={(e) => set('payment_date', e.target.value)} />

        <label style={label}>Amount (MYR)</label>
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

        {error && <p style={{ color: 'red' }}>{error}</p>}
        {editing && !isNew && <ChangesBanner changes={changes} />}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          {editing && (
            <button type="submit" disabled={saving} style={{ padding: '8px 16px' }}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          )}
          {!isNew && (
            <button type="button" onClick={() => navigate(`/payments/${id}/print`)} style={{ padding: '8px 16px' }}>
              View / Print Receipt
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
