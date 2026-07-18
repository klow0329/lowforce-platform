import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useEventContext } from '../context/EventContext';
import { exportToExcel } from '../utils/exportExcel';

const fmtMYR = (n) => `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

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

  function handleExport() {
    exportToExcel(
      salesOrders.map((so) => ({
        'Exhibitor Name': so.exhibitor_name,
        Type: so.contract_type === 'COEX' ? 'Co-Exhibitor' : 'Standard',
        'Contract Date': so.contract_date || '',
        'Total (MYR)': so.total_myr,
        Salesperson: so.salesperson_name || '',
      })),
      'contracts',
      'Contracts'
    );
  }

  return (
    <div className="page" style={{ maxWidth: 800, margin: '40px auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2>Contracts</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleExport}>Export to Excel</button>
          <button onClick={() => navigate('/sales-orders/new')}>+ New Contract</button>
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
            <th>Company</th>
            <th>Type</th>
            <th>Contract Date</th>
            <th>Total</th>
            <th>Salesperson</th>
          </tr>
        </thead>
        <tbody>
          {salesOrders.map((so) => (
            <tr
              key={so.id}
              onClick={() => navigate(`/sales-orders/${so.id}`)}
              style={{ borderBottom: '1px solid #eee', cursor: 'pointer' }}
            >
              <td data-label="Company">{so.exhibitor_name}</td>
              <td data-label="Type">{so.contract_type === 'COEX' ? 'Co-Exhibitor' : 'Standard'}</td>
              <td data-label="Contract Date">{so.contract_date || '—'}</td>
              <td data-label="Total">{fmtMYR(so.total_myr)}</td>
              <td data-label="Salesperson">{so.salesperson_name || '—'}</td>
            </tr>
          ))}
          {salesOrders.length === 0 && (
            <tr><td colSpan={5}>No contracts for this event yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
