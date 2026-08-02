import { useEffect, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from 'recharts';
import { api } from '../../api/client';
import { useEventContext } from '../../context/EventContext';
import DataTable from '../../components/DataTable';
import { fmtMYR, fmtNum, fmtMYRShort, NAVY, ACCENT_BLUE } from './fmt';

export default function PerfByAgent() {
  const { selectedEventId } = useEventContext();
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!selectedEventId) return;
    setData(null);
    api.getPerfByAgent(selectedEventId).then(setData);
  }, [selectedEventId]);

  if (!data) return <p>Loading...</p>;

  const teamTotal = data.rows.reduce((acc, r) => acc + r.contracted_myr, 0);
  const chartData = data.rows.map((r) => ({
    name: r.name,
    Contracted: r.contracted_myr,
    Collected: r.collected_myr,
  }));

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Agent Analysis</h2>
      <p style={{ fontSize: 12, color: '#5c6070', marginTop: 0, marginBottom: 12 }}>
        Rolled up by Agent (the exhibitor's own field, not the internal salesperson) — approved contract value/sqm,
        confirmed invoicing and collection, and open pipeline for exhibitors under each agent.
      </p>

      {chartData.length > 0 && (
        <div style={{ width: '100%', height: 60 + chartData.length * 56, background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '12px 8px' }}>
          <ResponsiveContainer>
            <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" tickFormatter={fmtMYRShort} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={110} />
              <Tooltip formatter={(v) => fmtMYR(v)} />
              <Legend />
              <Bar dataKey="Contracted" fill={NAVY} barSize={14} />
              <Bar dataKey="Collected" fill={ACCENT_BLUE} barSize={14} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <DataTable
          screenKey="perf-agent"
          columns={[
            { key: 'name', label: 'Agent' },
            { key: 'contracted_myr', label: 'Contracted (RM)', render: (r) => fmtMYR(r.contracted_myr) },
            { key: 'team_pct', label: '% of Total', value: (r) => (teamTotal > 0 ? Number(((r.contracted_myr / teamTotal) * 100).toFixed(1)) : null), render: (r) => (teamTotal > 0 ? `${((r.contracted_myr / teamTotal) * 100).toFixed(1)}%` : '—') },
            { key: 'contracts', label: 'Contracts' },
            { key: 'exhibitors', label: 'Exhibitors' },
            { key: 'sqm', label: 'Sqm', render: (r) => fmtNum(r.sqm) },
            { key: 'invoiced_myr', label: 'Invoiced (RM)', render: (r) => fmtMYR(r.invoiced_myr), default: false },
            { key: 'collected_myr', label: 'Collected (RM)', render: (r) => fmtMYR(r.collected_myr) },
            { key: 'outstanding_myr', label: 'Outstanding (RM)', render: (r) => fmtMYR(r.outstanding_myr) },
            { key: 'pipeline_myr', label: 'Open Pipeline (RM)', render: (r) => fmtMYR(r.pipeline_myr) },
            { key: 'open_opps', label: 'Open Opps', default: false },
          ]}
          rows={data.rows}
          getRowKey={(r) => r.agent_id}
          exportFilename="sales-by-agent"
          exportSheetName="By Agent"
        />
      </div>
    </div>
  );
}
