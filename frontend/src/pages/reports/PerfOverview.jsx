import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from 'recharts';
import { api } from '../../api/client';
import { useEventContext } from '../../context/EventContext';
import { fmtMYR, fmtNum, fmtPct, fmtMYRShort, NAVY, ORANGE, GREEN, RED, tile, tileLabel, tileValue } from './fmt';

export default function PerfOverview() {
  const { selectedEventId } = useEventContext();
  const [data, setData] = useState(null);
  const navigate = useNavigate();

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
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={tileLabel}>Sales Target</div>
              <div style={tileValue}>{fmtMYR(data.target.myr)}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={tileLabel}>Achieved</div>
              <div style={{ ...tileValue, color: salesPct != null && salesPct >= 100 ? GREEN : ORANGE }}>{fmtMYR(data.achieved.myr)}</div>
            </div>
          </div>
          {salesPct != null && (
            <div style={{ marginTop: 4, textAlign: 'right' }}>
              <span style={{
                fontSize: 14, fontWeight: 700, color: '#fff', padding: '2px 10px', borderRadius: 12,
                background: salesPct >= 100 ? GREEN : ORANGE,
              }}>
                {fmtPct(salesPct)} of target
              </span>
            </div>
          )}
        </div>
        <div style={tile}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={tileLabel}>Sqm Target</div>
              <div style={tileValue}>{fmtNum(data.target.sqm)} sqm</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={tileLabel}>Achieved</div>
              <div style={{ ...tileValue, color: sqmPct != null && sqmPct >= 100 ? GREEN : ORANGE }}>{fmtNum(data.achieved.sqm)} sqm</div>
            </div>
          </div>
          {sqmPct != null && (
            <div style={{ marginTop: 4, textAlign: 'right' }}>
              <span style={{
                fontSize: 14, fontWeight: 700, color: '#fff', padding: '2px 10px', borderRadius: 12,
                background: sqmPct >= 100 ? GREEN : ORANGE,
              }}>
                {fmtPct(sqmPct)} of target
              </span>
            </div>
          )}
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
        <div
          role="button" tabIndex={0} onClick={() => navigate('/reports/aging')}
          style={{ ...tile, background: data.outstanding > 0 ? '#fdecec' : '#fff', cursor: 'pointer' }}
          title="View Customer Aging detail"
        >
          <div style={tileLabel}>Outstanding</div>
          <div style={{ ...tileValue, color: data.outstanding > 0 ? RED : NAVY }}>{fmtMYR(data.outstanding)}</div>
          <div style={tileLabel}>click for detail →</div>
        </div>
        <div
          role="button" tabIndex={0} onClick={() => navigate('/opportunities')}
          style={{ ...tile, cursor: 'pointer' }}
          title="View Opportunities list"
        >
          <div style={tileLabel}>Opportunities</div>
          <div style={tileValue}>{data.opportunities.open} open</div>
          <div style={tileLabel}>{data.opportunities.won} won — click for detail →</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 24 }}>
        <div style={{ flex: '1 1 260px' }}>
          <h3 style={{ fontSize: 14, color: '#5c6070', margin: '0 0 8px' }}>By Local / International</h3>
          <table width="100%" cellPadding="6" style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                <th></th><th>Contracts</th><th>Sqm</th><th style={{ textAlign: 'right' }}>MYR</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>Local</td><td>{data.byType.local.contracts}</td><td>{fmtNum(data.byType.local.sqm)}</td><td style={{ textAlign: 'right' }}>{fmtMYR(data.byType.local.myr)}</td></tr>
              <tr><td>International</td><td>{data.byType.international.contracts}</td><td>{fmtNum(data.byType.international.sqm)}</td><td style={{ textAlign: 'right' }}>{fmtMYR(data.byType.international.myr)}</td></tr>
            </tbody>
          </table>
          <button type="button" onClick={() => navigate('/reports/country')} style={{ marginTop: 6, fontSize: 12, padding: '3px 10px' }}>By Country detail →</button>
        </div>

        <div style={{ flex: '1 1 260px' }}>
          <h3 style={{ fontSize: 14, color: '#5c6070', margin: '0 0 8px' }}>By Segment</h3>
          {data.bySegment.length === 0 ? (
            <p style={{ fontSize: 13, color: '#5c6070' }}>No approved contracts yet.</p>
          ) : (
            <table width="100%" cellPadding="6" style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                  <th>Segment</th><th>Contracts</th><th style={{ textAlign: 'right' }}>MYR</th>
                </tr>
              </thead>
              <tbody>
                {data.bySegment.map((r) => (
                  <tr key={r.segment}><td>{r.segment}</td><td>{r.contracts}</td><td style={{ textAlign: 'right' }}>{fmtMYR(r.myr)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ flex: '1 1 260px' }}>
          <h3 style={{ fontSize: 14, color: '#5c6070', margin: '0 0 8px' }}>By Item</h3>
          <p style={{ fontSize: 13, color: '#5c6070' }}>Full per-item revenue/sqm breakdown, local vs international.</p>
          <button type="button" onClick={() => navigate('/reports/items')} style={{ fontSize: 12, padding: '3px 10px' }}>By Item &amp; Type detail →</button>
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
