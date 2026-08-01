import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useEventContext } from '../context/EventContext';
import DataTable from '../components/DataTable';
import TaskToDoBox from '../components/TaskToDoBox';
import { isViewOnly } from '../utils/permissions';
import { toTitleCase } from '../utils/format';

const fmtMYR = (n) => `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function buildColumns(countryNames) {
  return [
    { key: 'exhibitor_name', label: 'Company', default: true },
    {
      key: 'created_at', label: 'Date', default: true,
      value: (r) => (r.created_at ? new Date(r.created_at).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'),
    },
    {
      key: 'stage_name', label: 'Stage', default: true,
      // A pending Value Change on the linked Contract doesn't move this
      // Opportunity's own stage — flagged alongside it instead of replacing
      // it (2026-08-01 user request).
      render: (r) => (
        <span style={{ color: r.is_won ? '#1A9C5B' : r.is_lost ? '#D13434' : 'inherit' }}>
          {r.stage_name}
          {r.has_pending_value_change && (
            <span style={{ color: '#B8860B', fontSize: 12, fontWeight: 600 }}> · Value Change Pending</span>
          )}
        </span>
      ),
    },
    { key: 'total_sqm', label: 'Sqm', default: true, value: (r) => (r.total_sqm ?? '—') },
    { key: 'exhibitor_country', label: 'Country', default: false, value: (r) => (countryNames[r.exhibitor_country] || r.exhibitor_country || '—') },
    {
      key: 'booth_type_display', label: 'Booth Type', default: true,
      value: (r) => (toTitleCase(r.booth_type_display) || '—'),
    },
    { key: 'estimated_value_myr', label: 'Value', default: true, value: (r) => fmtMYR(r.estimated_value_myr) },
    { key: 'salesperson_name', label: 'Salesperson', default: true },
    { key: 'agent_name', label: 'Agent', default: false, value: (r) => r.agent_name || '—' },
    {
      key: 'existing_sales_order_id', label: 'Contract', default: true,
      render: (r) => (r.existing_sales_order_id ? <span style={{ color: '#1E7B34' }}>Yes</span> : '—'),
    },
    { key: 'next_follow_up_date', label: 'Follow-up', default: true },
    {
      key: 'latest_correspondence', label: 'Latest Correspondence', default: true,
      value: (r) => (r.latest_correspondence || '—'),
      render: (r) => (r.latest_correspondence ? (
        <span title={new Date(r.latest_correspondence_at).toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' })}>
          {r.latest_correspondence}
        </span>
      ) : <span style={{ color: '#5c6070' }}>—</span>),
    },
  ];
}

export default function OpportunitiesList({ user }) {
  const { selectedEventId, loading: eventLoading } = useEventContext();
  const navigate = useNavigate();

  const [summary, setSummary] = useState(null);
  const [opportunities, setOpportunities] = useState([]);
  const [stages, setStages] = useState([]);
  const [stageFilter, setStageFilter] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [tasks, setTasks] = useState(null);
  const [countryNames, setCountryNames] = useState({});

  useEffect(() => {
    api.listStages().then(({ stages }) => setStages(stages));
    api.listCountries().then(({ countries }) => setCountryNames(Object.fromEntries(countries.map((c) => [c.code, c.name]))));
  }, []);

  const cols = useMemo(() => buildColumns(countryNames), [countryNames]);

  useEffect(() => {
    if (!selectedEventId) return;
    api.getOpportunitySummary(selectedEventId).then(setSummary);
    api.getTasks(selectedEventId).then(setTasks);
  }, [selectedEventId]);

  useEffect(() => {
    if (!selectedEventId) return;
    api
      .listOpportunities({
        event_id: selectedEventId,
        stage_id: stageFilter,
        salesperson_id: mineOnly ? user.id : '',
        search,
      })
      .then(({ opportunities }) => setOpportunities(opportunities));
  }, [selectedEventId, stageFilter, mineOnly, search, user.id]);

  if (eventLoading) return <p style={{ maxWidth: 900, margin: '40px auto' }}>Loading...</p>;
  if (!selectedEventId) {
    return <p style={{ maxWidth: 900, margin: '40px auto' }}>No events set up yet — create one in Admin first.</p>;
  }

  return (
    <div className="page" style={{ maxWidth: 900, margin: '40px auto' }}>
      {tasks && (
        <TaskToDoBox
          title="Follow-Ups Due"
          items={tasks.opportunityFollowUps.map((t) => ({
            key: t.id, urgency: t.urgency,
            label: t.exhibitor_name, meta: t.remarks || t.next_follow_up_date,
            href: `/opportunities/${t.id}`,
          }))}
          emptyText="No follow-ups due, urgent or coming up in the next 7 days."
        />
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2>Opportunities</h2>
        {!isViewOnly(user) && <button onClick={() => navigate('/opportunities/new')}>+ Add Opportunity</button>}
      </div>

      {summary && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '16px 0 24px' }}>
          {summary.byStage.map((s) => (
            <button
              key={s.stage_id}
              className="card-tile"
              onClick={() => setStageFilter(stageFilter === s.stage_id ? '' : s.stage_id)}
              style={{
                flex: '1 1 140px',
                textAlign: 'left',
                padding: 12,
                border: stageFilter === s.stage_id ? '2px solid #1B3A6B' : '1px solid #ddd',
                background: s.is_won ? '#eafaf1' : s.is_lost ? '#fdecec' : '#fff',
              }}
            >
              <div style={{ fontSize: 12, color: '#5c6070' }}>{s.name}</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{s.opp_count}</div>
              <div style={{ fontSize: 12 }}>{fmtMYR(s.total_value_myr)} · {Number(s.total_sqm)} sqm</div>
              <div style={{ fontSize: 12, color: '#5c6070' }}>{s.company_count} companies</div>
            </button>
          ))}
          <div className="card-tile" style={{ flex: '1 1 140px', padding: 12, border: '1px solid #ddd', borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: '#5c6070' }}>Total</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{summary.totals.opp_count}</div>
            <div style={{ fontSize: 12 }}>{fmtMYR(summary.totals.total_value_myr)} · {Number(summary.totals.total_sqm)} sqm</div>
            <div style={{ fontSize: 12, color: '#5c6070' }}>
              {summary.totals.conversionRatePct.toFixed(1)}% conversion (won ÷ won+lost)
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          placeholder="Search company name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, padding: 8, minWidth: 160 }}
        />
        <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
          <option value="">All stages</option>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <label style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} /> My opportunities
        </label>
      </div>

      <DataTable
        screenKey="opportunities"
        columns={cols}
        rows={opportunities}
        getRowKey={(r) => r.id}
        onRowClick={(r) => navigate(`/opportunities/${r.id}`)}
        exportFilename="opportunities"
        exportSheetName="Opportunities"
      />
    </div>
  );
}
