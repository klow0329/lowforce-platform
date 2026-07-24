import { useEffect, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from 'recharts';
import { api } from '../../api/client';
import { useEventContext } from '../../context/EventContext';
import { fmtMYR, fmtNum, fmtPct, fmtMYRShort, NAVY, ORANGE, GREEN, RED, tile, tileLabel, tileValue } from './fmt';

export default function PerfOverview() {
  const { selectedEventId } = useEventContext();
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!selectedEventId) return;
    setData(null);
    api.getPerfOverview(selectedEventId).then(setData);
  }, [selectedEventId]);

  if (!data) return <p>Loading...</p>;

  const salesPct = data.target.myr > 0 ? (data.achieved.myr / data.target.myr) * 100 : null;
  const sqmPct = data.target.sqm > 0 ? (data.achieved.sqm / data.target.sqm) * 100 : null;

  // Cumulative curves from the monthly figures.
  let cumC = 0, cumP = 0;
  const trend = data.monthlyTrend.map((r) => {
    cumC += r.contracted;
    cumP += r.collected;
    return { month: r.month, Contracted: cumC, Collected: cumP };
  });

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Sales Report — Overview</h2>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={tile}>
          <div style={tileLabel}>Sales Target</div>
          <div style={tileValue}>{fmtMYR(data.target.myr)}</div>
          <div style={tileLabel}>
            Achieved {fmtMYR(data.achieved.myr)}
            {salesPct != null && <b style={{ color: salesPct >= 100 ? GREEN : ORANGE }}> ({fmtPct(salesPct)})</b>}
          </div>
        </div>
        <div style={tile}>
          <div style={tileLabel}>Sqm Target</div>
          <div style={tileValue}>{fmtNum(data.target.sqm)} sqm</div>
          <div style={tileLabel}>
            Achieved {fmtNum(data.achieved.sqm)} sqm
            {sqmPct != null && <b style={{ color: sqmPct >= 100 ? GREEN : ORANGE }}> ({fmtPct(sqmPct)})</b>}
          </div>
        </div>
        <div style={tile}>
          <div style={tileLabel}>Contracts Signed</div>
          <div style={tileValue}>{data.achieved.contracts}</div>
          <div style={tileLabel}>{data.achieved.exhibitors} exhibitors</div>
        </div>
        {data.daysToEvent != null && (
          <div style={{ ...tile, border: data.daysToEvent <= 60 ? `2px solid ${ORANGE}` : tile.border }}>
            <div style={tileLabel}>Days to Event</div>
            <div style={{ ...tileValue, color: data.daysToEvent <= 60 ? ORANGE : NAVY }}>
              {data.daysToEvent > 0 ? data.daysToEvent : 'Started'}
            </div>
            <div style={tileLabel}>starts {data.eventStartDate?.slice(0, 10)}</div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
        <div style={tile}>
          <div style={tileLabel}>Invoiced (confirmed)</div>
          <div style={tileValue}>{fmtMYR(data.invoiced)}</div>
        </div>
        <div style={{ ...tile, background: '#eafaf1' }}>
          <div style={tileLabel}>Collected</div>
          <div style={{ ...tileValue, color: GREEN }}>{fmtMYR(data.collected)}</div>
          <div style={tileLabel}>{data.invoiced > 0 ? `${((data.collected / data.invoiced) * 100).toFixed(1)}% of invoiced` : ''}</div>
        </div>
        <div style={{ ...tile, background: data.outstanding > 0 ? '#fdecec' : '#fff' }}>
          <div style={tileLabel}>Outstanding</div>
          <div style={{ ...tileValue, color: data.outstanding > 0 ? RED : NAVY }}>{fmtMYR(data.outstanding)}</div>
        </div>
        <div style={tile}>
          <div style={tileLabel}>Opportunities</div>
          <div style={tileValue}>{data.opportunities.open} open</div>
          <div style={tileLabel}>{data.opportunities.won} won</div>
        </div>
      </div>

      <h3 style={{ fontSize: 14, color: '#5c6070', marginTop: 24 }}>Cumulative Contracted vs Collected (MYR)</h3>
      {trend.length === 0 ? (
        <p>No contracted or collected amounts yet for this event.</p>
      ) : (
        <div style={{ width: '100%', height: 300, background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '12px 8px' }}>
          <ResponsiveContainer>
            <LineChart data={trend} margin={{ top: 8, right: 24, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={fmtMYRShort} tick={{ fontSize: 11 }} width={52} />
              <Tooltip formatter={(v) => fmtMYR(v)} />
              <Legend />
              <Line type="monotone" dataKey="Contracted" stroke={NAVY} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Collected" stroke={GREEN} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
