import { useEffect, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, LabelList,
} from 'recharts';
import { api } from '../../api/client';
import { useEventContext } from '../../context/EventContext';
import DataTable from '../../components/DataTable';
import { fmtMYR, fmtNum, fmtMYRShort, NAVY, GREEN, RED, tile, tileLabel, tileValue } from './fmt';

export default function PerfPipeline() {
  const { selectedEventId } = useEventContext();
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!selectedEventId) return;
    setData(null);
    api.getPerfPipeline(selectedEventId).then(setData);
  }, [selectedEventId]);

  if (!data) return <p>Loading...</p>;

  // Won/Lost are outcomes, not funnel steps — summarized beside the funnel.
  const openStages = data.stages.filter((s) => !s.is_won && !s.is_lost);
  const won = data.stages.filter((s) => s.is_won);
  const lost = data.stages.filter((s) => s.is_lost);
  const sumBy = (arr, k) => arr.reduce((acc, s) => acc + s[k], 0);

  const funnelData = openStages.map((s) => ({ name: s.name, Value: s.value_myr, count: s.count }));
  const allValue = sumBy(data.stages, 'value_myr');
  const pctOfAll = (v) => (allValue > 0 ? `${((v / allValue) * 100).toFixed(1)}%` : '—');

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Pipeline (By Stage)</h2>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ ...tile, background: '#eafaf1' }}>
          <div style={tileLabel}>Won</div>
          <div style={{ ...tileValue, color: GREEN }}>{sumBy(won, 'count')}</div>
          <div style={tileLabel}>{fmtMYR(sumBy(won, 'value_myr'))} · {fmtNum(sumBy(won, 'sqm'))} sqm</div>
        </div>
        <div style={{ ...tile, background: '#fdecec' }}>
          <div style={tileLabel}>Lost</div>
          <div style={{ ...tileValue, color: RED }}>{sumBy(lost, 'count')}</div>
          <div style={tileLabel}>{fmtMYR(sumBy(lost, 'value_myr'))}</div>
        </div>
        <div style={tile}>
          <div style={tileLabel}>Open Pipeline</div>
          <div style={tileValue}>{sumBy(openStages, 'count')}</div>
          <div style={tileLabel}>{fmtMYR(sumBy(openStages, 'value_myr'))}</div>
        </div>
      </div>

      {funnelData.length === 0 ? (
        <p>No pipeline stages configured.</p>
      ) : (
        <div style={{ width: '100%', height: 60 + funnelData.length * 60, background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '12px 8px' }}>
          <ResponsiveContainer>
            <BarChart data={funnelData} layout="vertical" margin={{ top: 8, right: 60, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" tickFormatter={fmtMYRShort} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={130} />
              <Tooltip formatter={(v) => fmtMYR(v)} />
              <Legend />
              <Bar dataKey="Value" fill={NAVY} barSize={26}>
                <LabelList dataKey="count" position="right" formatter={(v) => `${v} opp${v === 1 ? '' : 's'}`} style={{ fontSize: 11 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <DataTable
          screenKey="perf-pipeline"
          columns={[
            { key: 'name', label: 'Stage' },
            {
              key: 'status', label: 'Status',
              value: (r) => (r.is_won ? 'Won' : r.is_lost ? 'Lost' : 'Open'),
            },
            { key: 'count', label: 'Opportunities' },
            { key: 'value_myr', label: 'Value (RM)', render: (r) => fmtMYR(r.value_myr) },
            { key: 'pct', label: '% of Value', value: (r) => (allValue > 0 ? Number(((r.value_myr / allValue) * 100).toFixed(1)) : null), render: (r) => pctOfAll(r.value_myr) },
            { key: 'sqm', label: 'Sqm', render: (r) => fmtNum(r.sqm) },
          ]}
          rows={data.stages}
          getRowKey={(r) => r.code}
          exportFilename="pipeline-by-stage"
          exportSheetName="Pipeline"
        />
      </div>
    </div>
  );
}
