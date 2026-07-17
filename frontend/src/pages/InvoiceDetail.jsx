import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useEventContext } from '../context/EventContext';

const label = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, marginTop: 12 };
const inputStyle = { display: 'block', width: '100%', padding: 8, boxSizing: 'border-box' };
const fmtMYR = (n) => `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function InvoiceDetail() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { selectedEventId } = useEventContext();

  const lockedSalesOrderId = searchParams.get('sales_order_id') || '';
  const lockedExhibitorName = searchParams.get('exhibitor_name') || '';
  const lockedTotal = searchParams.get('total_myr') || '';

  const [form, setForm] = useState({
    sales_order_id: lockedSalesOrderId,
    invoice_date: new Date().toISOString().slice(0, 10),
    amount_myr: lockedTotal,
  });
  const [exhibitorName, setExhibitorName] = useState(lockedExhibitorName);
  const [contractSearch, setContractSearch] = useState('');
  const [contractResults, setContractResults] = useState([]);
  const [invoiceNo, setInvoiceNo] = useState('');
  const [balanceDue, setBalanceDue] = useState(0);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function loadInvoice() {
    api.getInvoice(id).then(({ invoice }) => {
      setForm({
        sales_order_id: invoice.sales_order_id,
        invoice_date: invoice.invoice_date || '',
        amount_myr: invoice.amount_myr,
      });
      setExhibitorName(invoice.company_name);
      setInvoiceNo(invoice.invoice_no);
      setBalanceDue(invoice.balance_due);
      setLoading(false);
    });
    api.listPayments(id).then(({ payments }) => setPayments(payments));
  }

  useEffect(() => {
    if (isNew) return;
    loadInvoice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isNew]);

  useEffect(() => {
    if (!contractSearch || !selectedEventId) {
      setContractResults([]);
      return;
    }
    const t = setTimeout(() => {
      api.listSalesOrders({ event_id: selectedEventId, search: contractSearch }).then(({ salesOrders }) => setContractResults(salesOrders));
    }, 250);
    return () => clearTimeout(t);
  }, [contractSearch, selectedEventId]);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function selectContract(so) {
    set('sales_order_id', so.id);
    set('amount_myr', so.total_myr);
    setExhibitorName(so.exhibitor_name);
    setContractSearch('');
    setContractResults([]);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!form.sales_order_id) {
      setError('Please select a contract to invoice.');
      return;
    }

    setSaving(true);
    try {
      if (isNew) {
        const { invoice } = await api.createInvoice(form);
        navigate(`/invoices/${invoice.id}`);
      } else {
        await api.updateInvoice(id, form);
        navigate('/invoices');
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
        <h2>{isNew ? 'New Invoice' : `Invoice ${invoiceNo}`}</h2>
        <button type="button" onClick={() => navigate('/invoices')}>Back to list</button>
      </div>

      <form onSubmit={handleSubmit}>
        <label style={label}>Contract *</label>
        {lockedSalesOrderId || !isNew ? (
          <div style={{ padding: 8, background: '#F5F6FA', borderRadius: 4 }}>{exhibitorName}</div>
        ) : form.sales_order_id ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 8, background: '#F5F6FA', borderRadius: 4 }}>
            <span>{exhibitorName}</span>
            <button type="button" onClick={() => { set('sales_order_id', ''); setExhibitorName(''); }}>Change</button>
          </div>
        ) : (
          <div>
            <input
              style={inputStyle}
              placeholder="Search company name..."
              value={contractSearch}
              onChange={(e) => setContractSearch(e.target.value)}
            />
            {contractResults.length > 0 && (
              <div style={{ border: '1px solid #ddd', borderTop: 'none', maxHeight: 160, overflowY: 'auto' }}>
                {contractResults.map((so) => (
                  <div
                    key={so.id}
                    onClick={() => selectContract(so)}
                    style={{ padding: 8, cursor: 'pointer', borderBottom: '1px solid #eee' }}
                  >
                    {so.exhibitor_name} — {so.contract_type === 'COEX' ? 'Co-Exhibitor' : 'Standard'} — {fmtMYR(so.total_myr)}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <label style={label}>Invoice Date</label>
        <input type="date" style={inputStyle} value={form.invoice_date} onChange={(e) => set('invoice_date', e.target.value)} />

        <label style={label}>Amount (MYR)</label>
        <input type="number" step="0.01" style={inputStyle} value={form.amount_myr} onChange={(e) => set('amount_myr', e.target.value)} />

        {error && <p style={{ color: 'red' }}>{error}</p>}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button type="submit" disabled={saving} style={{ padding: '8px 16px' }}>
            {saving ? 'Saving...' : 'Save'}
          </button>
          {!isNew && (
            <button type="button" onClick={() => navigate(`/invoices/${id}/print`)} style={{ padding: '8px 16px' }}>
              View / Print Invoice
            </button>
          )}
        </div>
      </form>

      {!isNew && (
        <div style={{ marginTop: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3>Payments — Balance Due: {fmtMYR(balanceDue)}</h3>
            {balanceDue > 0 && (
              <button
                type="button"
                onClick={() => {
                  const params = new URLSearchParams({ invoice_id: id, invoice_no: invoiceNo, balance_due: balanceDue });
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
                  <td>{fmtMYR(p.amount_myr)}</td>
                </tr>
              ))}
              {payments.length === 0 && (
                <tr><td colSpan={4}>No payments recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
