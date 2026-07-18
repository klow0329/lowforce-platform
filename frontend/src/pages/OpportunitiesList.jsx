import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useEventContext } from '../context/EventContext';
import { exportToExcel } from '../utils/exportExcel';

const fmtMYR = (n) => `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

export default function OpportunitiesList({ user }) {
  const { selectedEventId, loading: eventLoading } = useEventContext();
  const navigate = useNavigate();

  const [summary, setSummary] = useState(null);
  const [opportunities, setOpportunities] = useState([]);
  const [stages, setStages] = useState([]);
  const [stageFilter, setStageFilter] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.listStages().then(({ stages }) => setStages(stages));
  }, []);

  useEffect(() => {
    if (!selectedEventId) return;
    api.getOpportunitySummary(selectedEventId).then(setSummary);
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

  function handleExport() {
    exportToExcel(
      opportunities.map((o) => ({
        'Exhibitor Name': o.exhibitor_name,
        Event: o.event_name,
        Stage: o.stage_name,
        Sqm: o.booth_sqm || '',
        'Booth Type': o.booth_type || '',
        'Value (MYR)': o.estimated_value_myr,
        Salesperson: o.salesperson_name || '',
        'Follow-up': o.next_follow_up_date || '',
        Remarks: o.remarks || '',
      })),
      'opportunities',
      'Opportunities'
    );
  }

  return (
    <div className="page" style={{ maxWidth: 900, margin: '40px auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2>Opportunities</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleExport}>Export to Excel</button>
          <button onClick={() => navigate('/opportunities/new')}>+ Add Opportunity</button>
        </div>
      </div>

      {summary && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '16px 0 24px' }}>
          {summary.byStage.map((s) => (
            <button
              key={s.stage_id}
              onClick={() => setStageFilter(stageFilter === s.stage_id ? '' : s.stage_id)}
              style={{
                flex: '1 1 140px',
                textAlign: 'left',
                padding: 12,
                border: stageFilter === s.stage_id ? '2px solid #1B3A6B' : '1px solid #ddd',
                borderRadius: 8,
                background: s.is_won ? '#eafaf1' : s.is_lost ? '#fdecec' : '#fff',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: 12, color: '#5c6070' }}>{s.name}</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{s.opp_count}</div>
              <div style={{ fontSize: 12 }}>{fmtMYR(s.total_value_myr)} · {Number(s.total_sqm)} sqm</div>
              <div style={{ fontSize: 12, color: '#5c6070' }}>{s.company_count} companies</div>
            </button>
          ))}
          <div style={{ flex: '1 1 140px', padding: 12, border: '1px solid #ddd', borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: '#5c6070' }}>Total</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{summary.totals.opp_count}</div>
            <div style={{ fontSize: 12 }}>{fmtMYR(summary.totals.total_value_myr)} · {Number(summary.totals.total_sqm)} sqm</div>
            <div style={{ fontSize: 12, color: '#5c6070' }}>
              {summary.totals.conversionRatePct.toFixed(1)}% conversion (won ÷ won+lost)
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <input
          placeholder="Search company name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, padding: 8 }}
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

      <table className="responsive" width="100%" cellPadding="6">
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
            <th>Company</th>
            <th>Stage</th>
            <th>Sqm</th>
            <th>Value</th>
            <th>Salesperson</th>
            <th>Follow-up</th>
          </tr>
        </thead>
        <tbody>
          {opportunities.map((o) => (
            <tr
              key={o.id}
              onClick={() => navigate(`/opportunities/${o.id}`)}
              style={{ borderBottom: '1px solid #eee', cursor: 'pointer' }}
            >
              <td data-label="Company">{o.exhibitor_name}</td>
              <td data-label="Stage" style={{ color: o.is_won ? '#1A9C5B' : o.is_lost ? '#D13434' : 'inherit' }}>{o.stage_name}</td>
              <td data-label="Sqm">{o.booth_sqm || '—'}</td>
              <td data-label="Value">{fmtMYR(o.estimated_value_myr)}</td>
              <td data-label="Salesperson">{o.salesperson_name || '—'}</td>
              <td data-label="Follow-up">{o.next_follow_up_date || '—'}</td>
            </tr>
          ))}
          {opportunities.length === 0 && (
            <tr><td colSpan={6}>No opportunities for this event yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
