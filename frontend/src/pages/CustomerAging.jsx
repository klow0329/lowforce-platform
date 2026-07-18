import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useEventContext } from '../context/EventContext';
import DataTable from '../components/DataTable';

const fmtMYR = (n) => `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const columns = [
  { key: 'exhibitor_name', label: 'Company', default: true },
  { key: 'invoice_no', label: 'Invoice No', default: true },
  { key: 'invoice_date', label: 'Invoice Date', default: true },
  { key: 'days_overdue', label: 'Days Overdue', default: true },
  { key: 'bucket_label', label: 'Bucket', default: true },
  { key: 'balance_due', label: 'Balance', default: true, value: (r) => fmtMYR(r.balance_due) },
];

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

  return (
    <div className="page" style={{ maxWidth: 900, margin: '40px auto' }}>
      <h2>Customer Aging</h2>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '16px 0 24px' }}>
        {report.summary.map((b) => (
          <button
            key={b.label}
            className="card-tile"
            onClick={() => setBucketFilter(bucketFilter === b.label ? '' : b.label)}
            style={{
              flex: '1 1 140px',
              textAlign: 'left',
              padding: 12,
              border: bucketFilter === b.label ? '2px solid #1B3A6B' : '1px solid #ddd',
              background: b.totalBalance > 0 ? '#fdecec' : '#fff',
            }}
          >
            <div style={{ fontSize: 12, color: '#5c6070' }}>{b.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{fmtMYR(b.totalBalance)}</div>
            <div style={{ fontSize: 12, color: '#5c6070' }}>{b.count} invoice{b.count === 1 ? '' : 's'}</div>
          </button>
        ))}
        <div className="card-tile" style={{ flex: '1 1 140px', padding: 12, border: '1px solid #ddd', borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: '#5c6070' }}>Total Outstanding</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{fmtMYR(report.totalOutstanding)}</div>
          <div style={{ fontSize: 12, color: '#5c6070' }}>{report.invoices.length} invoice{report.invoices.length === 1 ? '' : 's'}</div>
        </div>
      </div>

      <DataTable
        screenKey="customer-aging"
        columns={columns}
        rows={visibleInvoices}
        getRowKey={(r) => r.id}
        onRowClick={(r) => navigate(`/invoices/${r.id}`)}
        exportFilename="customer-aging"
        exportSheetName="Customer Aging"
      />
    </div>
  );
}
