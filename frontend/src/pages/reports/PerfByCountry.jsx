import { useEffect, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from 'recharts';
import { api } from '../../api/client';
import { useEventContext } from '../../context/EventContext';
import DataTable from '../../components/DataTable';
import { fmtMYR, fmtNum, fmtMYRShort, NAVY, ACCENT_BLUE, GREEN, tile, tileLabel, tileValue } from './fmt';

export default function PerfByCountry() {
  const { selectedEventId } = useEventContext();
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!selectedEventId) return;
    setData(null);
    api.getPerfByCountry(selectedEventId).then(setData);
  }, [selectedEventId]);

  if (!data) return <p>Loading...</p>;

  const local = data.rows.filter((r) => r.type === 'LOCAL');
  const intl = data.rows.filter((r) => r.type === 'INT');
  const sumBy = (arr, k) => arr.reduce((acc, r) => acc + r[k], 0);
  const grandTotal = sumBy(data.rows, 'contracted_myr');
  const pctOfTotal = (v) => (grandTotal > 0 ? `${((v / grandTotal) * 100).toFixed(1)}%` : '—');

  // Top 12 countries by contracted value keeps the chart readable; the full
  // list is always in the table below.
  const chartData = data.rows.slice(0, 12).map((r) => ({
    name: r.code === '—' ? '?' : r.code,
    Contracted: r.contracted_myr,
  }));

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>By Country</h2>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={tile}>
          <div style={tileLabel}>Local (Malaysia)</div>
          <div style={tileValue}>{fmtMYR(sumBy(local, 'contracted_myr'))} <span style={{ fontSize: 14 }}>({pctOfTotal(sumBy(local, 'contracted_myr'))})</span></div>
          <div style={tileLabel}>{sumBy(local, 'exhibitors')} exhibitors · {fmtNum(sumBy(local, 'sqm'))} sqm</div>
        </div>
        <div style={tile}>
          <div style={tileLabel}>International</div>
          <div style={{ ...tileValue, color: ACCENT_BLUE }}>{fmtMYR(sumBy(intl, 'contracted_myr'))} <span style={{ fontSize: 14 }}>({pctOfTotal(sumBy(intl, 'contracted_myr'))})</span></div>
          <div style={tileLabel}>{sumBy(intl, 'exhibitors')} exhibitors · {fmtNum(sumBy(intl, 'sqm'))} sqm · {intl.length} countries</div>
        </div>
        <div style={{ ...tile, background: '#eafaf1' }}>
          <div style={tileLabel}>Total</div>
          <div style={{ ...tileValue, color: GREEN }}>{fmtMYR(sumBy(data.rows, 'contracted_myr'))}</div>
          <div style={tileLabel}>{sumBy(data.rows, 'exhibitors')} exhibitors</div>
        </div>
      </div>

      {chartData.length > 0 && (
        <div style={{ width: '100%', height: 300, background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '12px 8px' }}>
          <ResponsiveContainer>
            <BarChart data={chartData} margin={{ top: 8, right: 24, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={fmtMYRShort} tick={{ fontSize: 11 }} width={52} />
              <Tooltip formatter={(v) => fmtMYR(v)} />
              <Legend />
              <Bar dataKey="Contracted" fill={NAVY} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <DataTable
          screenKey="perf-country"
          columns={[
            { key: 'country', label: 'Country' },
            { key: 'type', label: 'Local / INT' },
            { key: 'exhibitors', label: 'Exhibitors' },
            { key: 'contracts', label: 'Contracts' },
            { key: 'contracted_myr', label: 'Contracted (RM)', render: (r) => fmtMYR(r.contracted_myr) },
            { key: 'pct', label: '% of Total', value: (r) => (grandTotal > 0 ? Number(((r.contracted_myr / grandTotal) * 100).toFixed(1)) : null), render: (r) => pctOfTotal(r.contracted_myr) },
            { key: 'sqm', label: 'Sqm', render: (r) => fmtNum(r.sqm) },
          ]}
          rows={data.rows}
          getRowKey={(r) => r.code}
          exportFilename="sales-by-country"
          exportSheetName="By Country"
        />
      </div>
    </div>
  );
}
