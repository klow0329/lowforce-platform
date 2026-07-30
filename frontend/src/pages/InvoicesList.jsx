import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useEventContext } from '../context/EventContext';
import DataTable from '../components/DataTable';

const fmtMYR = (n) => `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function InvoicesList() {
  const { selectedEventId, loading: eventLoading } = useEventContext();
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState([]);
  const [search, setSearch] = useState('');

  const columns = [
    { key: 'invoice_no', label: 'Invoice No', default: true },
    { key: 'exhibitor_name', label: 'Company', default: true },
    { key: 'invoice_date', label: 'Invoice Date', default: true },
    { key: 'status', label: 'Status', default: true, value: (r) => (r.status === 'DRAFT' ? 'Draft' : 'Confirmed') },
    {
      key: 'exchange_rate', label: 'Currency Rate', default: true,
      value: (r) => (r.currency === 'USD' ? Number(r.exchange_rate) : 1),
      render: (r) => (r.currency === 'USD' ? Number(r.exchange_rate).toFixed(4) : '—'),
    },
    {
      key: 'amount_foreign', label: 'Doc Currency', default: true,
      value: (r) => Number(r.amount_foreign),
      render: (r) => `${r.currency} ${Number(r.amount_foreign).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    },
    { key: 'amount_myr', label: 'Local Currency', default: true, value: (r) => fmtMYR(r.amount_myr) },
    {
      key: 'payment_status', label: 'Payment', default: true,
      // Shows the actual amount still owed, not just the word "Outstanding"
      // — a partially-paid invoice (e.g. RM5,000 paid off a RM12,000
      // invoice) needs the real RM7,000 balance visible here, not just a
      // status label that hides how much is actually left.
      value: (r) => Number(r.balance_due) || 0,
      render: (r) => {
        if (r.status === 'DRAFT') return <span style={{ color: '#5c6070' }}>—</span>;
        const balance = Number(r.balance_due) || 0;
        const outstanding = balance > 0.01;
        return (
          <span
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/customer-aging?exhibitor=${encodeURIComponent(r.exhibitor_name)}`);
            }}
            style={{
              color: outstanding ? '#c83c3c' : '#1E7B34', fontWeight: 600,
              cursor: outstanding ? 'pointer' : 'default', textDecoration: outstanding ? 'underline' : 'none',
            }}
            title={outstanding ? 'Go to Customer Aging' : undefined}
          >
            {outstanding ? `${fmtMYR(balance)} outstanding` : 'Paid'}
          </span>
        );
      },
    },
  ];

  useEffect(() => {
    if (!selectedEventId) return;
    api.listInvoices({ event_id: selectedEventId, search }).then(({ invoices }) => setInvoices(invoices));
  }, [selectedEventId, search]);

  if (eventLoading) return <p style={{ maxWidth: 800, margin: '40px auto' }}>Loading...</p>;
  if (!selectedEventId) {
    return <p style={{ maxWidth: 800, margin: '40px auto' }}>No events set up yet — create one in Admin first.</p>;
  }

  return (
    <div className="page" style={{ maxWidth: 800, margin: '40px auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2>Invoices</h2>
      </div>
      <p style={{ fontSize: 13, color: '#5c6070' }}>
        Invoices are generated from a contract — open the contract and use "Generate Draft Invoice(s)".
      </p>

      <input
        placeholder="Search company name..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ width: '100%', padding: 8, margin: '16px 0', boxSizing: 'border-box' }}
      />

      <DataTable
        screenKey="invoices"
        columns={columns}
        rows={invoices}
        getRowKey={(r) => r.id}
        onRowClick={(r) => navigate(`/invoices/${r.id}`)}
        exportFilename="invoices"
        exportSheetName="Invoices"
      />
    </div>
  );
}
