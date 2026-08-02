import { useEffect, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from 'recharts';
import { api } from '../../api/client';
import { useEventContext } from '../../context/EventContext';
import DataTable from '../../components/DataTable';
import { fmtMYR, fmtMYRShort, NAVY, ACCENT_BLUE, GREEN } from './fmt';

export default function PerfByMonth() {
  const { selectedEventId } = useEventContext();
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!selectedEventId) return;
    setData(null);
    api.getPerfByMonth(selectedEventId).then(setData);
  }, [selectedEventId]);

  if (!data) return <p>Loading...</p>;

  // Running totals for the cumulative lines and the table.
  let cumC = 0, cumP = 0;
  const totalContracted = data.rows.reduce((acc, r) => acc + r.contracted, 0);
  const rows = data.rows.map((r) => {
    cumC += r.contracted;
    cumP += r.collected;
    return {
      ...r,
      cum_contracted: cumC,
      cum_collected: cumP,
      outstanding: cumC - cumP,
      pct_of_total: totalContracted > 0 ? Number(((r.contracted / totalContracted) * 100).toFixed(1)) : null,
      collected_pct: cumC > 0 ? Number(((cumP / cumC) * 100).toFixed(1)) : null,
    };
  });

  const chartData = rows.map((r) => ({
    month: r.month,
    'Contracted (month)': r.contracted,
    'Collected (month)': r.collected,
    'Cumulative Contracted': r.cum_contracted,
    'Cumulative Collected': r.cum_collected,
  }));

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Revenue &amp; Collection by Month</h2>

      {chartData.length === 0 ? (
        <p>No contracted or collected amounts yet for this event.</p>
      ) : (
        <div style={{ width: '100%', height: 340, background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '12px 8px' }}>
          <ResponsiveContainer>
            <ComposedChart data={chartData} margin={{ top: 8, right: 24, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis tickFormatter={fmtMYRShort} tick={{ fontSize: 11 }} width={52} />
              <Tooltip formatter={(v) => fmtMYR(v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Contracted (month)" fill={NAVY} />
              <Bar dataKey="Collected (month)" fill={GREEN} />
              <Line type="monotone" dataKey="Cumulative Contracted" stroke={ACCENT_BLUE} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Cumulative Collected" stroke={GREEN} strokeWidth={2} strokeDasharray="5 3" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <DataTable
          screenKey="perf-month"
          columns={[
            { key: 'month', label: 'Month' },
            { key: 'contracted', label: 'Contracted (RM)', render: (r) => fmtMYR(r.contracted) },
            { key: 'pct_of_total', label: '% of Total Contracted', render: (r) => (r.pct_of_total == null ? '—' : `${r.pct_of_total}%`) },
            { key: 'invoiced', label: 'Invoiced (RM)', render: (r) => fmtMYR(r.invoiced) },
            { key: 'collected', label: 'Collected (RM)', render: (r) => fmtMYR(r.collected) },
            { key: 'cum_contracted', label: 'Cumulative Contracted (RM)', render: (r) => fmtMYR(r.cum_contracted) },
            { key: 'cum_collected', label: 'Cumulative Collected (RM)', render: (r) => fmtMYR(r.cum_collected) },
            { key: 'collected_pct', label: 'Collected % (cumulative)', render: (r) => (r.collected_pct == null ? '—' : `${r.collected_pct}%`) },
            { key: 'outstanding', label: 'Contracted, Not Collected (RM)', render: (r) => fmtMYR(r.outstanding), default: false },
          ]}
          rows={rows}
          getRowKey={(r) => r.month}
          exportFilename="revenue-collection-by-month"
          exportSheetName="By Month"
        />
      </div>
    </div>
  );
}
