import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { computeChanges, confirmSave, ChangesBanner, fieldsetStyle } from '../utils/recordForm';

const label = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, marginTop: 12 };
const inputStyle = { display: 'block', width: '100%', padding: 8, boxSizing: 'border-box' };
const fmt = (n, ccy = 'MYR') => `${ccy === 'USD' ? 'USD' : 'RM'} ${Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function InvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  // Invoices are now system-generated as drafts from a contract (see
  // SalesOrderDetail's "Generate Draft Invoice(s)") — this screen is where
  // Finance reviews the draft, fills in the real date/invoice no./exchange
  // rate to match their accounting system, then commits it.
  const [form, setForm] = useState({
    invoice_no: '',
    invoice_date: '',
    exchange_rate: '',
    amount_foreign: '',
    discount_type: '',
    discount_value: '',
  });
  const [invoice, setInvoice] = useState(null);
  const [balanceDue, setBalanceDue] = useState(0);
  const [payments, setPayments] = useState([]);
  const [original, setOriginal] = useState(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function loadInvoice() {
    api.getInvoice(id).then(({ invoice }) => {
      const loaded = {
        invoice_no: invoice.invoice_no,
        invoice_date: invoice.invoice_date || '',
        exchange_rate: invoice.exchange_rate,
        amount_foreign: invoice.amount_foreign,
        discount_type: invoice.discount_type || '',
        discount_value: invoice.discount_value ?? '',
      };
      setForm(loaded);
      setOriginal(loaded);
      setInvoice(invoice);
      setBalanceDue(invoice.balance_due);
      setEditing(invoice.status === 'DRAFT');
      setLoading(false);
    });
    api.listPayments(id).then(({ payments }) => setPayments(payments));
  }

  useEffect(() => {
    loadInvoice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const changes = computeChanges(original, form);
  const amountMyr = Number(form.amount_foreign || 0) * Number(form.exchange_rate || 1);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!confirmSave(changes, 'invoice', false)) return;
    setSaving(true);
    try {
      await api.updateInvoice(id, form);
      loadInvoice();
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirm() {
    if (!window.confirm(`Confirm invoice ${form.invoice_no} at ${fmt(amountMyr)}? Once confirmed it counts as final.`)) return;
    setError('');
    setSaving(true);
    try {
      await api.updateInvoice(id, { ...form, status: 'CONFIRMED' });
      loadInvoice();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p style={{ maxWidth: 600, margin: '40px auto' }}>Loading...</p>;

  return (
    <div className="page" style={{ maxWidth: 600, margin: '40px auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          Invoice {invoice.invoice_no}
          <span style={{
            background: invoice.status === 'DRAFT' ? '#FFF3BF' : '#E3F6E8',
            color: invoice.status === 'DRAFT' ? '#8a6d1a' : '#1E7B34',
            padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600,
          }}>
            {invoice.status === 'DRAFT' ? 'DRAFT' : 'CONFIRMED'}
          </span>
        </h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {!editing && <button type="button" onClick={() => setEditing(true)}>Edit</button>}
          <button type="button" onClick={() => navigate(`/sales-orders/${invoice.sales_order_id}`)}>Back to Contract</button>
        </div>
      </div>

      <p style={{ color: '#5c6070' }}>{invoice.company_name}{invoice.billing_pct ? ` — Milestone ${Number(invoice.billing_pct)}% of contract` : ''}</p>

      <form onSubmit={handleSubmit}>
        <fieldset disabled={!editing} style={fieldsetStyle}>
        <label style={label}>Invoice No.</label>
        <input style={inputStyle} value={form.invoice_no} onChange={(e) => set('invoice_no', e.target.value)} required />

        <label style={label}>Invoice Date</label>
        <input type="date" style={inputStyle} value={form.invoice_date} onChange={(e) => set('invoice_date', e.target.value)} />

        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={label}>Amount ({invoice.currency})</label>
            <input type="number" step="0.01" style={inputStyle} value={form.amount_foreign} onChange={(e) => set('amount_foreign', e.target.value)} required />
          </div>
          <div style={{ flex: 1 }}>
            <label style={label}>Exchange Rate (1 {invoice.currency} = ? MYR)</label>
            <input type="number" step="0.0001" style={inputStyle} value={form.exchange_rate} onChange={(e) => set('exchange_rate', e.target.value)} required disabled={invoice.currency === 'MYR'} />
          </div>
        </div>
        {invoice.currency === 'USD' && (
          <p style={{ fontSize: 12, color: '#5c6070' }}>
            Enter the actual rate used for this invoice — installments on the same contract can carry different rates as the market moves.
          </p>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={label}>Discount</label>
            <select style={inputStyle} value={form.discount_type} onChange={(e) => set('discount_type', e.target.value)}>
              <option value="">— None —</option>
              <option value="FLAT">Flat amount</option>
              <option value="PERCENT">Percentage (%)</option>
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={label}>Discount Value</label>
            <input type="number" step="0.01" style={inputStyle} value={form.discount_value} onChange={(e) => set('discount_value', e.target.value)} disabled={!form.discount_type} />
          </div>
        </div>

        <p style={{ fontWeight: 600, marginTop: 16 }}>Amount in MYR: {fmt(amountMyr)}</p>
        </fieldset>

        {error && <p style={{ color: 'red' }}>{error}</p>}
        {editing && <ChangesBanner changes={changes} />}

        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          {editing && (
            <button type="submit" disabled={saving} style={{ padding: '8px 16px' }}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          )}
          {invoice.status === 'DRAFT' && (
            <button type="button" disabled={saving} onClick={handleConfirm} style={{ padding: '8px 16px' }}>
              Confirm Invoice
            </button>
          )}
          <button type="button" onClick={() => navigate(`/invoices/${id}/print`)} style={{ padding: '8px 16px' }}>
            View / Print Invoice
          </button>
        </div>
      </form>

      <div style={{ marginTop: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>Payments — Balance Due: {fmt(balanceDue)}</h3>
          {balanceDue > 0 && (
            <button
              type="button"
              onClick={() => {
                const params = new URLSearchParams({ invoice_id: id, invoice_no: invoice.invoice_no, balance_due: balanceDue });
                navigate(`/payments/new?${params}`);
              }}
            >
              Record Payment
            </button>
          )}
        </div>
        <table width="100%" cellPadding="6">
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
              <th>Receipt No</th>
              <th>Date</th>
              <th>Method</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr
                key={p.id}
                onClick={() => navigate(`/payments/${p.id}`)}
                style={{ borderBottom: '1px solid #eee', cursor: 'pointer' }}
              >
                <td>{p.receipt_no}</td>
                <td>{p.payment_date || '—'}</td>
                <td>{p.payment_method || '—'}</td>
                <td>{fmt(p.amount_myr)}</td>
              </tr>
            ))}
            {payments.length === 0 && (
              <tr><td colSpan={4}>No payments recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
