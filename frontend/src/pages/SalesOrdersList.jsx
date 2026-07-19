import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useEventContext } from '../context/EventContext';
import DataTable from '../components/DataTable';

const fmtMYR = (n) => `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const columns = [
  { key: 'exhibitor_name', label: 'Company', default: true },
  { key: 'contract_date', label: 'Contract Date', default: true },
  { key: 'total_myr', label: 'Total', default: true, value: (r) => fmtMYR(r.total_myr) },
  { key: 'salesperson_name', label: 'Salesperson', default: true },
];

export default function SalesOrdersList() {
  const { selectedEventId, loading: eventLoading } = useEventContext();
  const navigate = useNavigate();
  const [salesOrders, setSalesOrders] = useState([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!selectedEventId) return;
    api.listSalesOrders({ event_id: selectedEventId, search }).then(({ salesOrders }) => setSalesOrders(salesOrders));
  }, [selectedEventId, search]);

  if (eventLoading) return <p style={{ maxWidth: 800, margin: '40px auto' }}>Loading...</p>;
  if (!selectedEventId) {
    return <p style={{ maxWidth: 800, margin: '40px auto' }}>No events set up yet — create one in Admin first.</p>;
  }

  return (
    <div className="page" style={{ maxWidth: 800, margin: '40px auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2>Contracts</h2>
        <button onClick={() => navigate('/sales-orders/new')}>+ New Contract</button>
      </div>

      <input
        placeholder="Search company name..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ width: '100%', padding: 8, margin: '16px 0', boxSizing: 'border-box' }}
      />

      <DataTable
        screenKey="contracts"
        columns={columns}
        rows={salesOrders}
        getRowKey={(r) => r.id}
        onRowClick={(r) => navigate(`/sales-orders/${r.id}`)}
        exportFilename="contracts"
        exportSheetName="Contracts"
      />
    </div>
  );
}
