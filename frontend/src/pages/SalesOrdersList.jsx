import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useEventContext } from '../context/EventContext';
import DataTable from '../components/DataTable';
import TaskToDoBox from '../components/TaskToDoBox';

const fmtMYR = (n) => `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const STATUS_LABELS = { DRAFT: 'Draft', PENDING_APPROVAL: 'Pending Approval', APPROVED: 'Approved' };
const STATUS_TILE_BG = { DRAFT: '#fff', PENDING_APPROVAL: '#FFF3BF', APPROVED: '#eafaf1' };

const columns = [
  { key: 'exhibitor_name', label: 'Company', default: true },
  { key: 'booth_no', label: 'Booth No', default: true, value: (r) => (r.booth_no ? `${r.hall ? `${r.hall} / ` : ''}${r.booth_no}` : '—') },
  { key: 'contract_date', label: 'Contract Date', default: true },
  { key: 'status', label: 'Status', default: true, value: (r) => STATUS_LABELS[r.status] || r.status },
  { key: 'total_myr', label: 'Total', default: true, value: (r) => fmtMYR(r.total_myr) },
  { key: 'salesperson_name', label: 'Salesperson', default: true },
];

export default function SalesOrdersList() {
  const { selectedEventId, loading: eventLoading } = useEventContext();
  const navigate = useNavigate();
  const [salesOrders, setSalesOrders] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [tasks, setTasks] = useState(null);

  useEffect(() => {
    if (!selectedEventId) return;
    api.listSalesOrders({ event_id: selectedEventId, search }).then(({ salesOrders }) => setSalesOrders(salesOrders));
    api.getTasks(selectedEventId).then(setTasks);
  }, [selectedEventId, search]);

  if (eventLoading) return <p style={{ maxWidth: 800, margin: '40px auto' }}>Loading...</p>;
  if (!selectedEventId) {
    return <p style={{ maxWidth: 800, margin: '40px auto' }}>No events set up yet — create one in Admin first.</p>;
  }

  const kpis = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'].map((status) => {
    const matching = salesOrders.filter((so) => so.status === status);
    return {
      status,
      label: STATUS_LABELS[status],
      count: matching.length,
      totalValue: matching.reduce((sum, so) => sum + Number(so.total_myr || 0), 0),
    };
  });

  const visibleOrders = statusFilter ? salesOrders.filter((so) => so.status === statusFilter) : salesOrders;

  return (
    <div className="page" style={{ maxWidth: 900, margin: '40px auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2>Contracts</h2>
      </div>
      <p style={{ fontSize: 13, color: '#5c6070' }}>
        Contracts are created by transferring a won opportunity — open the opportunity and use "Generate Contract".
      </p>

      {tasks && (
        <TaskToDoBox
          title="Pending Approval"
          items={tasks.pendingApprovals.map((t) => ({
            key: t.id, urgency: t.urgency,
            label: t.exhibitor_name, meta: t.contract_date || 'No date',
            href: `/sales-orders/${t.id}`,
          }))}
          emptyText="Nothing waiting on approval."
        />
      )}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '16px 0 24px' }}>
        {kpis.map((k) => (
          <button
            key={k.status}
            className="card-tile"
            onClick={() => setStatusFilter(statusFilter === k.status ? '' : k.status)}
            style={{
              flex: '1 1 140px', textAlign: 'left', padding: 12,
              border: statusFilter === k.status ? '2px solid #1B3A6B' : '1px solid #ddd',
              background: STATUS_TILE_BG[k.status],
            }}
          >
            <div style={{ fontSize: 12, color: '#5c6070' }}>{k.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{k.count}</div>
            <div style={{ fontSize: 12 }}>{fmtMYR(k.totalValue)}</div>
          </button>
        ))}
        <div className="card-tile" style={{ flex: '1 1 140px', padding: 12, border: '1px solid #ddd', borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: '#5c6070' }}>Total Contracts</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{salesOrders.length}</div>
          <div style={{ fontSize: 12 }}>{fmtMYR(salesOrders.reduce((s, so) => s + Number(so.total_myr || 0), 0))}</div>
        </div>
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
        rows={visibleOrders}
        getRowKey={(r) => r.id}
        onRowClick={(r) => navigate(`/sales-orders/${r.id}`)}
        exportFilename="contracts"
        exportSheetName="Contracts"
      />
    </div>
  );
}
