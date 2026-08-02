import { useEffect, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from 'recharts';
import { api } from '../../api/client';
import { useEventContext } from '../../context/EventContext';
import DataTable from '../../components/DataTable';
import { fmtMYR, fmtNum, fmtMYRShort, NAVY, ACCENT_BLUE } from './fmt';

export default function PerfByItem() {
  const { selectedEventId } = useEventContext();
  const [data, setData] = useState(null);
  const [metric, setMetric] = useState('myr'); // 'myr' | 'sqm'

  useEffect(() => {
    if (!selectedEventId) return;
    setData(null);
    api.getPerfByItem(selectedEventId).then(setData);
  }, [selectedEventId]);

  if (!data) return <p>Loading...</p>;

  const isMyr = metric === 'myr';
  const grandTotal = data.rows.reduce((acc, r) => acc + r.myr_total, 0);
  const pctOfTotal = (v) => (grandTotal > 0 ? `${((v / grandTotal) * 100).toFixed(1)}%` : '—');
  const chartRows = (isMyr ? data.rows : data.rows.filter((r) => r.sqm_total > 0)).map((r) => ({
    code: r.code,
    Local: isMyr ? r.myr_local : r.sqm_local,
    International: isMyr ? r.myr_int : r.sqm_int,
  }));

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>By Item &amp; Type</h2>

      <div style={{ marginBottom: 4, display: 'flex', gap: 12, alignItems: 'center' }}>
        <label><input type="radio" checked={isMyr} onChange={() => setMetric('myr')} /> Value (MYR)</label>
        <label><input type="radio" checked={!isMyr} onChange={() => setMetric('sqm')} /> Floor space (sqm)</label>
      </div>
      <p style={{ fontSize: 12, color: '#5c6070', marginTop: 0, marginBottom: 12 }}>
        An upgraded booth (Shell Scheme, Enhanced Shell, Walk-On Package, Custom Build) is no longer Bare Space — its
        sqm is reclassified out of Bare Space and into its own upgrade row, so every row's sqm adds up to the same
        Total Sqm shown under Overview.
      </p>

      {chartRows.length === 0 ? (
        <p>No contracted line items yet for this event.</p>
      ) : (
        <div style={{ width: '100%', height: 300, background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '12px 8px' }}>
          <ResponsiveContainer>
            <BarChart data={chartRows} margin={{ top: 8, right: 24, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="code" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={isMyr ? fmtMYRShort : undefined} tick={{ fontSize: 11 }} width={52} />
              <Tooltip formatter={(v) => (isMyr ? fmtMYR(v) : `${fmtNum(v)} sqm`)} />
              <Legend />
              <Bar dataKey="Local" stackId="a" fill={NAVY} />
              <Bar dataKey="International" stackId="a" fill={ACCENT_BLUE} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <DataTable
          screenKey="perf-items"
          columns={[
            { key: 'code', label: 'Item' },
            { key: 'description', label: 'Description' },
            { key: 'myr_int', label: 'INT (RM)', render: (r) => fmtMYR(r.myr_int) },
            { key: 'myr_local', label: 'Local (RM)', render: (r) => fmtMYR(r.myr_local) },
            { key: 'myr_total', label: 'Total (RM)', render: (r) => fmtMYR(r.myr_total) },
            { key: 'pct', label: '% of Total', value: (r) => (grandTotal > 0 ? Number(((r.myr_total / grandTotal) * 100).toFixed(1)) : null), render: (r) => pctOfTotal(r.myr_total) },
            { key: 'sqm_int', label: 'INT (sqm)', render: (r) => fmtNum(r.sqm_int), default: false },
            { key: 'sqm_local', label: 'Local (sqm)', render: (r) => fmtNum(r.sqm_local), default: false },
            { key: 'sqm_total', label: 'Total (sqm)', render: (r) => fmtNum(r.sqm_total) },
          ]}
          rows={data.rows}
          getRowKey={(r) => r.code}
          exportFilename="sales-by-item"
          exportSheetName="By Item"
        />
      </div>
    </div>
  );
}
