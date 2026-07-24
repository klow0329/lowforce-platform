import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useEventContext } from '../context/EventContext';

const fmtMYR = (n) => `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const tile = {
  flex: '1 1 160px',
  textAlign: 'left',
  padding: 12,
  border: '1px solid #ddd',
  borderRadius: 8,
  background: '#fff',
  cursor: 'pointer',
  color: '#202330',
};
const tileLabel = { fontSize: 12, color: '#5c6070' };
const tileValue = { fontSize: 22, fontWeight: 700, color: '#1B3A6B' };
const section = { border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 24 };

function daysSince(dateStr) {
  if (!dateStr) return '—';
  const diff = Math.round((new Date() - new Date(dateStr)) / (1000 * 60 * 60 * 24));
  return diff <= 0 ? 'Today' : `${diff}d ago`;
}

// Management's own landing screen — high-level KPIs (same underlying data
// as the Sales Dashboard, just decision-oriented rather than a personal
// to-do list) with the contract Approvals Queue front and center, since
// approving is Management's actual recurring task on this system. Gated to
// ADM/MGT in NavBar/App.jsx, matching the same roles the approve/reject
// endpoints themselves require (isElevated in visibility.js).
export default function Management({ user }) {
  const { selectedEventId, loading: eventLoading } = useEventContext();
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState(null);
  const [tasks, setTasks] = useState(null);
  const [oppSummary, setOppSummary] = useState(null);
  const [aging, setAging] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  function loadAll() {
    if (!selectedEventId) return;
    api.getDashboard(selectedEventId).then(setDashboard);
    api.getTasks(selectedEventId).then(setTasks);
    api.getOpportunitySummary(selectedEventId).then(setOppSummary);
    api.getCustomerAging(selectedEventId).then(setAging);
  }

  useEffect(loadAll, [selectedEventId]);

  async function handleApprove(id) {
    if (!window.confirm('Approve this contract? It becomes Sold on the Floor Plan and can proceed to invoicing.')) return;
    setBusyId(id);
    setError('');
    try {
      await api.approveSalesOrder(id);
      loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(id) {
    if (!window.confirm('Reject this contract? It goes back to Draft for the salesperson to revise.')) return;
    setBusyId(id);
    setError('');
    try {
      await api.rejectSalesOrder(id);
      loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  if (eventLoading || (selectedEventId && !dashboard)) return <p style={{ maxWidth: 1000, margin: '40px auto' }}>Loading...</p>;
  if (!selectedEventId) {
    return <p style={{ maxWidth: 1000, margin: '40px auto' }}>No events set up yet — create one in Admin first.</p>;
  }

  const pendingApprovals = tasks?.pendingApprovals || [];

  return (
    <div className="page" style={{ maxWidth: 1000, margin: '40px auto' }}>
      <h2>Management Overview</h2>
      {error && <p style={{ color: 'red' }}>{error}</p>}

      <h3 style={{ fontSize: 14, color: '#5c6070', marginTop: 0 }}>At a Glance</h3>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
        <button style={tile} onClick={() => navigate('/opportunities')}>
          <div style={tileLabel}>Active Opportunities</div>
          <div style={tileValue}>{dashboard.opportunities.active}</div>
        </button>
        <button style={tile} onClick={() => navigate('/opportunities')}>
          <div style={tileLabel}>Conversion Rate</div>
          <div style={tileValue}>{dashboard.opportunities.conversionRatePct.toFixed(1)}%</div>
        </button>
        <button style={tile} onClick={() => navigate('/sales-orders')}>
          <div style={tileLabel}>Total Contract Value</div>
          <div style={tileValue}>{fmtMYR(dashboard.totalContractValue)}</div>
        </button>
        <button style={tile} onClick={() => navigate('/invoices')}>
          <div style={tileLabel}>Total Collected</div>
          <div style={{ ...tileValue, color: '#1A9C5B' }}>{fmtMYR(dashboard.totalCollected)}</div>
        </button>
        <button style={{ ...tile, background: dashboard.totalOutstanding > 0 ? '#fdecec' : '#fff' }} onClick={() => navigate('/customer-aging')}>
          <div style={tileLabel}>Total Outstanding (AR)</div>
          <div style={{ ...tileValue, color: dashboard.totalOutstanding > 0 ? '#D13434' : 'inherit' }}>{fmtMYR(dashboard.totalOutstanding)}</div>
        </button>
        <button style={tile} onClick={() => navigate('/opportunities')} title="Bare Space, Shell Scheme, Enhanced Shell, Walk-On Package and Custom Build only">
          <div style={tileLabel}>Total Booths (Won)</div>
          <div style={tileValue}>{dashboard.totalBooths.count}</div>
          <div style={tileLabel}>{dashboard.totalBooths.totalSqm} sqm</div>
        </button>
        <button
          style={{ ...tile, border: pendingApprovals.length > 0 ? '2px solid #F47920' : tile.border }}
          onClick={() => document.getElementById('approvals-queue')?.scrollIntoView({ behavior: 'smooth' })}
        >
          <div style={tileLabel}>Awaiting My Approval</div>
          <div style={{ ...tileValue, color: pendingApprovals.length > 0 ? '#F47920' : 'inherit' }}>{pendingApprovals.length}</div>
        </button>
      </div>

      <div id="approvals-queue" style={section}>
        <h3 style={{ marginTop: 0 }}>Approvals Queue</h3>
        {pendingApprovals.length === 0 ? (
          <p style={{ fontSize: 13, color: '#5c6070' }}>Nothing pending approval right now.</p>
        ) : (
          <table width="100%" cellPadding="6">
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                <th>Exhibitor</th><th>Salesperson</th><th>Contract Value</th><th>Submitted</th><th></th>
              </tr>
            </thead>
            <tbody>
              {pendingApprovals.map((p) => (
                <tr key={p.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td>{p.exhibitor_name}</td>
                  <td>{p.salesperson_name || '—'}</td>
                  <td>{p.currency} {Number(p.total_myr || 0).toLocaleString('en-MY', { minimumFractionDigits: 2 })}</td>
                  <td>{daysSince(p.contract_date)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button onClick={() => navigate(`/sales-orders/${p.id}`)}>View</button>{' '}
                    <button onClick={() => handleApprove(p.id)} disabled={busyId === p.id}>Approve</button>{' '}
                    <button onClick={() => handleReject(p.id)} disabled={busyId === p.id}>Reject</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {oppSummary && (
        <div style={section}>
          <h3 style={{ marginTop: 0 }}>Pipeline by Stage</h3>
          <table width="100%" cellPadding="6">
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                <th>Stage</th><th>Opportunities</th><th>Companies</th><th>Sqm</th><th>Est. Value</th>
              </tr>
            </thead>
            <tbody>
              {oppSummary.byStage.filter((s) => Number(s.opp_count) > 0).map((s) => (
                <tr key={s.stage_id} style={{ borderBottom: '1px solid #eee', cursor: 'pointer' }} onClick={() => navigate('/opportunities')}>
                  <td>{s.name}</td>
                  <td>{s.opp_count}</td>
                  <td>{s.company_count}</td>
                  <td>{Number(s.total_sqm).toLocaleString('en-MY')}</td>
                  <td>{fmtMYR(s.total_value_myr)}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700 }}>
                <td>Total</td>
                <td>{oppSummary.totals.opp_count}</td>
                <td>—</td>
                <td>{Number(oppSummary.totals.total_sqm).toLocaleString('en-MY')}</td>
                <td>{fmtMYR(oppSummary.totals.total_value_myr)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {aging && (
        <div style={section}>
          <h3 style={{ marginTop: 0 }}>AR Aging Snapshot</h3>
          <table width="100%" cellPadding="6">
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                <th>Bucket</th><th>Invoices</th><th>Balance Due</th>
              </tr>
            </thead>
            <tbody>
              {aging.summary.map((b) => (
                <tr key={b.label} style={{ borderBottom: '1px solid #eee' }}>
                  <td>{b.label}</td>
                  <td>{b.count}</td>
                  <td>{fmtMYR(b.totalBalance)}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700 }}>
                <td>Total Outstanding</td>
                <td></td>
                <td>{fmtMYR(aging.totalOutstanding)}</td>
              </tr>
            </tbody>
          </table>
          <button style={{ marginTop: 12 }} onClick={() => navigate('/customer-aging')}>View Full Aging Report</button>
        </div>
      )}
    </div>
  );
}
