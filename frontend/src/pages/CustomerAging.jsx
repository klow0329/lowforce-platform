import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useEventContext } from '../context/EventContext';
import { exportToExcel } from '../utils/exportExcel';

const fmtMYR = (n) => `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

export default function CustomerAging() {
  const { selectedEventId, loading: eventLoading } = useEventContext();
  const navigate = useNavigate();
  const [report, setReport] = useState(null);
  const [bucketFilter, setBucketFilter] = useState('');

  useEffect(() => {
    if (!selectedEventId) return;
    api.getCustomerAging(selectedEventId).then(setReport);
  }, [selectedEventId]);

  if (eventLoading || (selectedEventId && !report)) return <p style={{ maxWidth: 900, margin: '40px auto' }}>Loading...</p>;
  if (!selectedEventId) {
    return <p style={{ maxWidth: 900, margin: '40px auto' }}>No events set up yet — create one in Admin first.</p>;
  }

  const visibleInvoices = bucketFilter
    ? report.invoices.filter((inv) => inv.bucket_label === bucketFilter)
    : report.invoices;

  function handleExport() {
    exportToExcel(
      visibleInvoices.map((inv) => ({
        'Exhibitor Name': inv.exhibitor_name,
        'Invoice No': inv.invoice_no,
        'Invoice Date': inv.invoice_date,
        'Days Overdue': inv.days_overdue,
        Bucket: inv.bucket_label || '',
        'Balance (MYR)': Number(inv.balance_due),
      })),
      'customer-aging',
      'Customer Aging'
    );
  }

  return (
    <div className="page" style={{ maxWidth: 900, margin: '40px auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2>Customer Aging</h2>
        <button onClick={handleExport}>Export to Excel</button>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '16px 0 24px' }}>
        {report.summary.map((b) => (
          <button
            key={b.label}
            onClick={() => setBucketFilter(bucketFilter === b.label ? '' : b.label)}
            style={{
              flex: '1 1 140px',
              textAlign: 'left',
              padding: 12,
              border: bucketFilter === b.label ? '2px solid #1B3A6B' : '1px solid #ddd',
              borderRadius: 8,
              background: b.totalBalance > 0 ? '#fdecec' : '#fff',
              cursor: 'pointer',
            }}
          >
            <div style={{ fontSize: 12, color: '#5c6070' }}>{b.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{fmtMYR(b.totalBalance)}</div>
            <div style={{ fontSize: 12, color: '#5c6070' }}>{b.count} invoice{b.count === 1 ? '' : 's'}</div>
          </button>
        ))}
        <div style={{ flex: '1 1 140px', padding: 12, border: '1px solid #ddd', borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: '#5c6070' }}>Total Outstanding</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{fmtMYR(report.totalOutstanding)}</div>
          <div style={{ fontSize: 12, color: '#5c6070' }}>{report.invoices.length} invoice{report.invoices.length === 1 ? '' : 's'}</div>
        </div>
      </div>

      <table className="responsive" width="100%" cellPadding="6">
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
            <th>Company</th>
            <th>Invoice No</th>
            <th>Invoice Date</th>
            <th>Days Overdue</th>
            <th>Bucket</th>
            <th>Balance</th>
          </tr>
        </thead>
        <tbody>
          {visibleInvoices.map((inv) => (
            <tr
              key={inv.id}
              onClick={() => navigate(`/invoices/${inv.id}`)}
              style={{ borderBottom: '1px solid #eee', cursor: 'pointer' }}
            >
              <td data-label="Company">{inv.exhibitor_name}</td>
              <td data-label="Invoice No">{inv.invoice_no}</td>
              <td data-label="Invoice Date">{inv.invoice_date}</td>
              <td data-label="Days Overdue">{inv.days_overdue}</td>
              <td data-label="Bucket">{inv.bucket_label || '—'}</td>
              <td data-label="Balance">{fmtMYR(inv.balance_due)}</td>
            </tr>
          ))}
          {visibleInvoices.length === 0 && (
            <tr><td colSpan={6}>No outstanding balances for this event.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
