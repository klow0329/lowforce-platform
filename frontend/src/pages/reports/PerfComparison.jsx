import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from 'recharts';
import { api } from '../../api/client';
import { useEventContext } from '../../context/EventContext';
import { fmtMYR, fmtMYRShort, NAVY, ORANGE } from './fmt';

// Compares two events month by month, aligned on "months before/after event
// start" so e.g. MIFB26 and MIFB27 line up even though they're a year apart.
export default function PerfComparison() {
  const { events, selectedEventId } = useEventContext();
  const mainEvents = useMemo(() => events.filter((e) => !e.parent_event_id), [events]);
  const [compareId, setCompareId] = useState('');
  const [metric, setMetric] = useState('contracted'); // 'contracted' | 'collected'
  const [data, setData] = useState(null);

  // Default comparison: the first other main event (usually last year's).
  useEffect(() => {
    const other = mainEvents.find((e) => e.id !== selectedEventId);
    setCompareId(other ? other.id : '');
  }, [selectedEventId, mainEvents]);

  useEffect(() => {
    if (!selectedEventId) return;
    setData(null);
    api.getPerfComparison(selectedEventId, compareId || undefined).then(setData);
  }, [selectedEventId, compareId]);

  if (!data) return <p>Loading...</p>;

  const primaryName = data.primary.event.code || data.primary.event.name;
  const compareName = data.compare ? (data.compare.event.code || data.compare.event.name) : null;

  // Merge both series on the offset axis (months relative to event start).
  const byOffset = new Map();
  for (const p of data.primary.points) {
    if (p.offset == null) continue;
    byOffset.set(p.offset, { offset: p.offset, [primaryName]: p[metric], primaryMonth: p.month });
  }
  if (data.compare) {
    for (const p of data.compare.points) {
      if (p.offset == null) continue;
      const row = byOffset.get(p.offset) || { offset: p.offset };
      row[compareName] = p[metric];
      byOffset.set(p.offset, row);
    }
  }
  const merged = [...byOffset.values()].sort((a, b) => a.offset - b.offset);
  // Carry the running totals forward through months with no activity so the
  // cumulative lines don't dip to gaps.
  let lastP = null, lastC = null;
  for (const row of merged) {
    if (row[primaryName] == null && lastP != null) row[primaryName] = lastP; else if (row[primaryName] != null) lastP = row[primaryName];
    if (compareName) {
      if (row[compareName] == null && lastC != null) row[compareName] = lastC; else if (row[compareName] != null) lastC = row[compareName];
    }
  }

  const offsetLabel = (o) => (o < 0 ? `${-o} mth before` : o === 0 ? 'Event month' : `+${o} mth`);

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Event Comparison</h2>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <label>
          Compare against:{' '}
          <select value={compareId} onChange={(e) => setCompareId(e.target.value)}>
            <option value="">— none —</option>
            {mainEvents.filter((e) => e.id !== selectedEventId).map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </label>
        <span>
          <label style={{ marginRight: 12 }}>
            <input type="radio" checked={metric === 'contracted'} onChange={() => setMetric('contracted')} /> Contracted
          </label>
          <label>
            <input type="radio" checked={metric === 'collected'} onChange={() => setMetric('collected')} /> Collected
          </label>
        </span>
      </div>

      {merged.length === 0 ? (
        <p>No data to compare yet — figures appear once contracts/payments exist and the event has a start date.</p>
      ) : (
        <div style={{ width: '100%', height: 340, background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '12px 8px' }}>
          <ResponsiveContainer>
            <LineChart data={merged} margin={{ top: 8, right: 24, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="offset" tickFormatter={offsetLabel} tick={{ fontSize: 10 }} />
              <YAxis tickFormatter={fmtMYRShort} tick={{ fontSize: 11 }} width={52} />
              <Tooltip formatter={(v) => fmtMYR(v)} labelFormatter={offsetLabel} />
              <Legend />
              <Line type="monotone" dataKey={primaryName} stroke={NAVY} strokeWidth={2} dot={false} connectNulls />
              {compareName && <Line type="monotone" dataKey={compareName} stroke={ORANGE} strokeWidth={2} dot={false} connectNulls />}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <p style={{ fontSize: 12, color: '#5c6070' }}>
        Cumulative {metric} value (MYR), aligned by months relative to each event's start date.
      </p>
    </div>
  );
}
