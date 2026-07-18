import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useEventContext } from '../context/EventContext';
import DataTable from '../components/DataTable';

const fmtMYR = (n) => `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const columns = [
  { key: 'invoice_no', label: 'Invoice No', default: true },
  { key: 'exhibitor_name', label: 'Company', default: true },
  { key: 'invoice_date', label: 'Invoice Date', default: true },
  { key: 'amount_myr', label: 'Amount', default: true, value: (r) => fmtMYR(r.amount_myr) },
];

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

  return (
    <div className="page" style={{ maxWidth: 800, margin: '40px auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2>Invoices</h2>
        <button onClick={() => navigate('/invoices/new')}>+ New Invoice</button>
      </div>

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
