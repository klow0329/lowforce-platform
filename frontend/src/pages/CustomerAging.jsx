import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useEventContext } from '../context/EventContext';
import DataTable from '../components/DataTable';

const fmtMYR = (n) => `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

// stopPropagation on both cells — the row itself navigates to the invoice
// on click, which would otherwise fire every time someone tries to edit
// these fields inline.
function EditableDate({ value, onSave }) {
  return (
    <input
      type="date"
      defaultValue={value || ''}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onSave(e.target.value)}
      style={{ fontSize: 12, padding: 3 }}
    />
  );
}

function EditableNote({ value, onSave }) {
  const [val, setVal] = useState(value || '');
  return (
    <input
      value={val}
      placeholder="Add note..."
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => { if (val !== (value || '')) onSave(val); }}
      style={{ fontSize: 12, padding: 3, width: 160 }}
    />
  );
}

// embedded: rendered inside the Reports shell, which already provides the
// page container — skip the standalone wrapper to avoid double margins.
export default function CustomerAging({ embedded = false }) {
  const { selectedEventId, loading: eventLoading } = useEventContext();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [report, setReport] = useState(null);
  const [bucketFilter, setBucketFilter] = useState('');
  const exhibitorFilter = searchParams.get('exhibitor') || '';

  useEffect(() => {
    if (!selectedEventId) return;
    api.getCustomerAging(selectedEventId).then(setReport);
  }, [selectedEventId]);

  async function handleUpdateAging(invoiceId, payload) {
    await api.updateInvoice(invoiceId, payload);
    setReport((r) => ({
      ...r,
      invoices: r.invoices.map((inv) =>
        inv.id === invoiceId ? { ...inv, ...payload, aging_updated_at: new Date().toISOString() } : inv
      ),
    }));
  }

  if (eventLoading || (selectedEventId && !report)) return <p style={{ maxWidth: 900, margin: '40px auto' }}>Loading...</p>;
  if (!selectedEventId) {
    return <p style={{ maxWidth: 900, margin: '40px auto' }}>No events set up yet — create one in Admin first.</p>;
  }

  const columns = [
    { key: 'exhibitor_name', label: 'Company', default: true },
    { key: 'invoice_no', label: 'Invoice No', default: true },
    { key: 'invoice_date', label: 'Invoice Date', default: true },
    { key: 'days_overdue', label: 'Days Overdue', default: true },
    { key: 'bucket_label', label: 'Bucket', default: true },
    { key: 'balance_due', label: 'Balance', default: true, value: (r) => fmtMYR(r.balance_due) },
    {
      key: 'expected_payment_date', label: 'Expected Payment', default: true,
      value: (r) => <EditableDate value={r.expected_payment_date} onSave={(v) => handleUpdateAging(r.id, { expected_payment_date: v })} />,
    },
    {
      key: 'aging_notes', label: 'Correspondence', default: true,
      value: (r) => <EditableNote value={r.aging_notes} onSave={(v) => handleUpdateAging(r.id, { aging_notes: v })} />,
    },
    {
      key: 'aging_updated_at', label: 'Last Updated', default: true,
      value: (r) => (r.aging_updated_at ? new Date(r.aging_updated_at).toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' }) : '—'),
    },
  ];

  let visibleInvoices = bucketFilter
    ? report.invoices.filter((inv) => inv.bucket_label === bucketFilter)
    : report.invoices;
  if (exhibitorFilter) {
    visibleInvoices = visibleInvoices.filter((inv) => inv.exhibitor_name === exhibitorFilter);
  }

  return (
    <div className={embedded ? '' : 'page'} style={embedded ? {} : { maxWidth: 900, margin: '40px auto' }}>
      <h2 style={embedded ? { marginTop: 0 } : {}}>Customer Aging</h2>
      {exhibitorFilter && (
        <p style={{ fontSize: 13 }}>
          Filtered to <strong>{exhibitorFilter}</strong>{' '}
          <button type="button" onClick={() => setSearchParams({})} style={{ fontSize: 12 }}>Clear</button>
        </p>
      )}

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
