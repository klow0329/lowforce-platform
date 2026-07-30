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

// Real elapsed-time granularity (minutes/hours/days) — daysSince alone
// always read as "Today" or a whole day count, which looked wrong for
// something submitted moments ago.
function timeAgo(dateStr) {
  if (!dateStr) return '—';
  const diffMs = new Date() - new Date(dateStr);
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
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

  // Approvals Queue combines every request type an Admin/Management user
  // might need to act on — a plain contract approval, a Credit Note, or a
  // Contract Reduction — each backed by its own table/status, but shown as
  // one list so nothing gets missed by only checking the "sales order"
  // shaped ones. type-specific API calls are picked by p.type below.
  async function handleApprove(p) {
    const msg = p.type === 'cn' ? 'Approve this credit note?'
      : p.type === 'reduction' ? "Approve this contract reduction? This updates the contract's items/total and releases any staged booths immediately."
      : 'Approve this contract? It becomes Sold on the Floor Plan and can proceed to invoicing.';
    if (!window.confirm(msg)) return;
    setBusyId(p.id);
    setError('');
    try {
      if (p.type === 'cn') await api.approveCreditNote(p.id);
      else if (p.type === 'reduction') await api.approveContractReduction(p.id);
      else await api.approveSalesOrder(p.id);
      loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(p) {
    const notes = window.prompt(p.type === 'contract' ? 'Reason for rejecting (sent back to Draft):' : 'Reason for rejecting:');
    if (notes === null) return;
    setBusyId(p.id);
    setError('');
    try {
      if (p.type === 'cn') await api.rejectCreditNote(p.id, { notes });
      else if (p.type === 'reduction') await api.rejectContractReduction(p.id, { notes });
      else await api.rejectSalesOrder(p.id, { notes });
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

  // Everything actually waiting on an Admin/Management decision, from all
  // three tables that can be PENDING_APPROVAL — a plain contract carries
  // its own request as sales_orders.status, but a Credit Note or Contract
  // Reduction stays on an APPROVED contract while its own separate request
  // is pending (see contractReductions.controller.js), so those never
  // showed up here relying on sales_orders.status alone.
  const pendingApprovals = [
    ...(tasks?.pendingApprovals || []).map((p) => ({ ...p, type: 'contract' })),
    ...(tasks?.pendingCnApprovals || []).map((p) => ({ ...p, type: 'cn' })),
    ...(tasks?.pendingReductionApprovals || []).map((p) => ({ ...p, type: 'reduction' })),
  ];

  function approvalWhat(p) {
    if (p.type === 'cn') return `Credit note — RM${Number(p.amount_myr).toLocaleString('en-MY', { minimumFractionDigits: 2 })}`;
    if (p.type === 'reduction') {
      const cn = Number(p.cn_amount_myr) || 0;
      return `Contract reduction — ${p.currency} ${Number(p.old_total_foreign).toLocaleString('en-MY', { minimumFractionDigits: 2 })} → ${Number(p.new_total_foreign).toLocaleString('en-MY', { minimumFractionDigits: 2 })}`
        + (cn > 0.01 ? ` (+ RM${cn.toLocaleString('en-MY', { minimumFractionDigits: 2 })} credit note)` : '');
    }
    return p.submit_reason || 'New contract submitted for approval';
  }

  function approvalValue(p) {
    if (p.type === 'cn') return `RM ${Number(p.amount_myr || 0).toLocaleString('en-MY', { minimumFractionDigits: 2 })}`;
    if (p.type === 'reduction') return `${p.currency} ${Number(p.new_total_foreign || 0).toLocaleString('en-MY', { minimumFractionDigits: 2 })}`;
    return `${p.currency} ${Number(p.total_myr || 0).toLocaleString('en-MY', { minimumFractionDigits: 2 })}`;
  }

  function approvalHref(p) {
    if (p.type === 'cn') return `/credit-notes/${p.id}`;
    if (p.type === 'reduction') return `/sales-orders/${p.sales_order_id}`;
    return `/sales-orders/${p.id}`;
  }

  return (
    <div className="page" style={{ maxWidth: 1000, margin: '40px auto' }}>
      <div id="approvals-queue" style={section}>
        <h3 style={{ marginTop: 0 }}>Approvals Queue</h3>
        {pendingApprovals.length === 0 ? (
          <p style={{ fontSize: 13, color: '#5c6070' }}>Nothing pending approval right now.</p>
        ) : (
          <table width="100%" cellPadding="6">
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                <th>Exhibitor</th><th>Salesperson</th><th>What</th><th>Value</th><th>Submitted</th><th></th>
              </tr>
            </thead>
            <tbody>
              {pendingApprovals.map((p) => (
                <tr key={`${p.type}-${p.id}`} style={{ borderBottom: '1px solid #eee' }}>
                  <td>{p.exhibitor_name}</td>
                  <td>{p.salesperson_name || '—'}</td>
                  <td style={{ fontSize: 12, color: '#5c6070' }}>{approvalWhat(p)}</td>
                  <td>{approvalValue(p)}</td>
                  <td>{timeAgo(p.submitted_at || p.contract_date || p.created_at)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button onClick={() => navigate(approvalHref(p))}>View</button>{' '}
                    <button onClick={() => handleApprove(p)} disabled={busyId === p.id}>Approve</button>{' '}
                    <button onClick={() => handleReject(p)} disabled={busyId === p.id}>Reject</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

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
