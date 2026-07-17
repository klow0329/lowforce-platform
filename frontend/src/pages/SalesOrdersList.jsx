import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useEventContext } from '../context/EventContext';

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

  return (
    <div style={{ maxWidth: 800, margin: '40px auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Contracts</h2>
        <button onClick={() => navigate('/sales-orders/new')}>+ New Contract</button>
      </div>

      <input
        placeholder="Search company name..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ width: '100%', padding: 8, margin: '16px 0' }}
      />

      <table width="100%" cellPadding="6">
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
              <td>{so.exhibitor_name}</td>
              <td>{so.contract_type === 'COEX' ? 'Co-Exhibitor' : 'Standard'}</td>
              <td>{so.contract_date || '—'}</td>
              <td>{fmtMYR(so.total_myr)}</td>
              <td>{so.salesperson_name || '—'}</td>
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
