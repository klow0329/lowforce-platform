import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useEventContext } from '../context/EventContext';
import DataTable from '../components/DataTable';
import TaskToDoBox from '../components/TaskToDoBox';
import { toTitleCase } from '../utils/format';

const fmtMYR = (n) => `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS_LABELS = {
  DRAFT: 'Draft', PENDING_APPROVAL: 'Pending Approval', PENDING_APPROVAL_STEP2: 'Pending 2nd Approval',
  APPROVED: 'Approved', VOID: 'Void',
};
const STATUS_TILE_BG = { DRAFT: '#fff', PENDING_APPROVAL: '#FFF3BF', PENDING_APPROVAL_STEP2: '#FFF3BF', APPROVED: '#eafaf1', VOID: '#FBE3E3' };

// Booth Allocation (picked-vs-total sqm) dropped per the sales team — booths
// are now fully allocated before an Opportunity can even become a Contract
// (see task #133/#156), so the tracker never had anything left to warn
// about by the time a contract exists. Total Sqm/Country/Sales Agent are
// more useful at this stage.
function buildColumns(countryNames) {
  return [
    { key: 'exhibitor_name', label: 'Company', default: true },
    { key: 'booth_no', label: 'Booth No', default: true, value: (r) => (r.booth_no ? `${r.hall ? `${r.hall} / ` : ''}${r.booth_no}` : '—') },
    { key: 'total_sqm', label: 'Total Sqm', default: true, value: (r) => (r.total_sqm ?? '—') },
    { key: 'contract_date', label: 'Contract Date', default: true },
    {
      key: 'status', label: 'Status', default: true,
      // A pending Value Change doesn't touch the Contract's own status —
      // it stays exactly as-approved until the request resolves — but the
      // list should say so's under review rather than plain "Approved"
      // (2026-08-01 user request). Reverts on its own once the request
      // clears, since has_pending_value_change is a live check, not a
      // stored flag.
      value: (r) => (r.status === 'APPROVED' && r.has_pending_value_change
        ? 'Approved — Value Change Pending'
        : (STATUS_LABELS[r.status] || r.status)),
    },
    { key: 'total_myr', label: 'Total', default: true, value: (r) => fmtMYR(r.total_myr) },
    { key: 'salesperson_name', label: 'Salesperson', default: true },
    { key: 'agent_name', label: 'Sales Agent', default: false, value: (r) => (r.agent_name || '—') },
    { key: 'exhibitor_country', label: 'Country', default: false, value: (r) => (countryNames[r.exhibitor_country] || r.exhibitor_country || '—') },
    {
      key: 'booth_type_display', label: 'Booth Type', default: true,
      value: (r) => (toTitleCase(r.booth_type_display) || '—'),
    },
  ];
}

export default function SalesOrdersList() {
  const { selectedEventId, loading: eventLoading } = useEventContext();
  const navigate = useNavigate();
  const [salesOrders, setSalesOrders] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [tasks, setTasks] = useState(null);
  const [countryNames, setCountryNames] = useState({});

  useEffect(() => {
    api.listCountries().then(({ countries }) => setCountryNames(Object.fromEntries(countries.map((c) => [c.code, c.name]))));
  }, []);

  useEffect(() => {
    if (!selectedEventId) return;
    api.listSalesOrders({ event_id: selectedEventId, search }).then(({ salesOrders }) => setSalesOrders(salesOrders));
    api.getTasks(selectedEventId).then(setTasks);
  }, [selectedEventId, search]);

  const cols = useMemo(() => buildColumns(countryNames), [countryNames]);

  if (eventLoading) return <p style={{ maxWidth: 800, margin: '40px auto' }}>Loading...</p>;
  if (!selectedEventId) {
    return <p style={{ maxWidth: 800, margin: '40px auto' }}>No events set up yet — create one in Admin first.</p>;
  }

  // The Pending Approval tile/filter covers both approval steps — a
  // contract awaiting its 2nd sign-off is still "pending", just further
  // along, not a separate bucket the sales team needs to track apart.
  const statusMatches = (so, status) => (
    status === 'PENDING_APPROVAL' ? ['PENDING_APPROVAL', 'PENDING_APPROVAL_STEP2'].includes(so.status) : so.status === status
  );

  const kpis = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'].map((status) => {
    const matching = salesOrders.filter((so) => statusMatches(so, status));
    return {
      status,
      label: STATUS_LABELS[status],
      count: matching.length,
      totalValue: matching.reduce((sum, so) => sum + Number(so.total_myr || 0), 0),
    };
  });

  const visibleOrders = statusFilter ? salesOrders.filter((so) => statusMatches(so, statusFilter)) : salesOrders;

  return (
    <div className="page" style={{ maxWidth: 900, margin: '40px auto' }}>
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

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2>Contracts</h2>
      </div>
      <p style={{ fontSize: 13, color: '#5c6070' }}>
        Contracts are created by transferring a won opportunity — open the opportunity and use "Generate Contract".
      </p>

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
        columns={cols}
        rows={visibleOrders}
        getRowKey={(r) => r.id}
        onRowClick={(r) => navigate(`/sales-orders/${r.id}`)}
        exportFilename="contracts"
        exportSheetName="Contracts"
      />
    </div>
  );
}
