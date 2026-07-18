import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useEventContext } from '../context/EventContext';
import { exportToExcel } from '../utils/exportExcel';

const fmtMYR = (n) => `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

export default function InvoicesList() {
  const { selectedEventId, loading: eventLoading } = useEventContext();
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!selectedEventId) return;
    api.listInvoices({ event_id: selectedEventId, search }).then(({ invoices }) => setInvoices(invoices));
  }, [selectedEventId, search]);

  if (eventLoading) return <p style={{ maxWidth: 800, margin: '40px auto' }}>Loading...</p>;
  if (!selectedEventId) {
    return <p style={{ maxWidth: 800, margin: '40px auto' }}>No events set up yet — create one in Admin first.</p>;
  }

  function handleExport() {
    exportToExcel(
      invoices.map((inv) => ({
        'Invoice No': inv.invoice_no,
        'Exhibitor Name': inv.exhibitor_name,
        'Invoice Date': inv.invoice_date || '',
        'Amount (MYR)': inv.amount_myr,
      })),
      'invoices',
      'Invoices'
    );
  }

  return (
    <div className="page" style={{ maxWidth: 800, margin: '40px auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2>Invoices</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleExport}>Export to Excel</button>
          <button onClick={() => navigate('/invoices/new')}>+ New Invoice</button>
        </div>
      </div>

      <input
        placeholder="Search company name..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ width: '100%', padding: 8, margin: '16px 0' }}
      />

      <table className="responsive" width="100%" cellPadding="6">
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
            <th>Invoice No</th>
            <th>Company</th>
            <th>Invoice Date</th>
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
              <td data-label="Invoice No">{inv.invoice_no}</td>
              <td data-label="Company">{inv.exhibitor_name}</td>
              <td data-label="Invoice Date">{inv.invoice_date || '—'}</td>
              <td data-label="Amount">{fmtMYR(inv.amount_myr)}</td>
            </tr>
          ))}
          {invoices.length === 0 && (
            <tr><td colSpan={4}>No invoices for this event yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
