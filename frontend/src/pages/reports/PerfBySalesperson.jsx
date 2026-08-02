import { useEffect, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from 'recharts';
import { api } from '../../api/client';
import { useEventContext } from '../../context/EventContext';
import DataTable from '../../components/DataTable';
import { fmtMYR, fmtNum, fmtPct, fmtMYRShort, NAVY, ACCENT_BLUE } from './fmt';

export default function PerfBySalesperson({ user }) {
  const { selectedEventId } = useEventContext();
  const [data, setData] = useState(null);
  const [targets, setTargets] = useState(null);
  const [editingTargets, setEditingTargets] = useState(false);
  const [saving, setSaving] = useState(false);
  const isAdmin = user?.role_code === 'ADM';

  const load = () => {
    if (!selectedEventId) return;
    api.getPerfBySalesperson(selectedEventId).then(setData);
    if (isAdmin) api.getSalesTargets(selectedEventId).then((r) => setTargets(r.rows));
  };
  useEffect(load, [selectedEventId, isAdmin]);

  if (!data) return <p>Loading...</p>;

  const teamTotal = data.rows.reduce((acc, r) => acc + r.contracted_myr, 0);
  const chartData = data.rows.map((r) => ({
    name: r.name,
    Target: r.target_myr,
    Contracted: r.contracted_myr,
  }));

  const saveTargets = async () => {
    setSaving(true);
    try {
      await api.saveSalesTargets({
        event_id: selectedEventId,
        targets: targets.map((t) => ({ user_id: t.user_id, target_myr: t.target_myr, target_sqm: t.target_sqm })),
      });
      setEditingTargets(false);
      load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>By Salesperson</h2>
      {data.ownOnly && (
        <p style={{ fontSize: 13, color: '#5c6070' }}>Showing your own performance. Management sees the whole team here.</p>
      )}

      {chartData.length > 0 && (
        <div style={{ width: '100%', height: 60 + chartData.length * 56, background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '12px 8px' }}>
          <ResponsiveContainer>
            <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" tickFormatter={fmtMYRShort} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={110} />
              <Tooltip formatter={(v) => fmtMYR(v)} />
              <Legend />
              <Bar dataKey="Target" fill={ACCENT_BLUE} barSize={14} />
              <Bar dataKey="Contracted" fill={NAVY} barSize={14} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <DataTable
          screenKey="perf-salesperson"
          columns={[
            { key: 'name', label: 'Salesperson' },
            { key: 'target_myr', label: 'Target (RM)', render: (r) => fmtMYR(r.target_myr) },
            { key: 'contracted_myr', label: 'Contracted (RM)', render: (r) => fmtMYR(r.contracted_myr) },
            { key: 'achieved_pct', label: 'Achieved %', render: (r) => fmtPct(r.achieved_pct) },
            { key: 'team_pct', label: '% of Team', value: (r) => (teamTotal > 0 ? Number(((r.contracted_myr / teamTotal) * 100).toFixed(1)) : null), render: (r) => (teamTotal > 0 ? `${((r.contracted_myr / teamTotal) * 100).toFixed(1)}%` : '—') },
            { key: 'contracts', label: 'Contracts' },
            { key: 'sqm', label: 'Sqm', render: (r) => fmtNum(r.sqm) },
            { key: 'target_sqm', label: 'Sqm Target', render: (r) => fmtNum(r.target_sqm), default: false },
            { key: 'invoiced_myr', label: 'Invoiced (RM)', render: (r) => fmtMYR(r.invoiced_myr), default: false },
            { key: 'collected_myr', label: 'Collected (RM)', render: (r) => fmtMYR(r.collected_myr) },
            { key: 'outstanding_myr', label: 'Outstanding (RM)', render: (r) => fmtMYR(r.outstanding_myr) },
            { key: 'pipeline_myr', label: 'Open Pipeline (RM)', render: (r) => fmtMYR(r.pipeline_myr) },
            { key: 'open_opps', label: 'Open Opps', default: false },
          ]}
          rows={data.rows}
          getRowKey={(r) => r.user_id}
          exportFilename="sales-by-salesperson"
          exportSheetName="By Salesperson"
        />
      </div>

      {isAdmin && targets && (
        <div style={{ marginTop: 24, border: '1px solid #ddd', borderRadius: 8, background: '#fff', padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>Sales Targets (Admin)</h3>
            {!editingTargets
              ? <button type="button" onClick={() => setEditingTargets(true)}>Edit Targets</button>
              : (
                <span style={{ display: 'flex', gap: 8 }}>
                  <button type="button" onClick={() => { setEditingTargets(false); load(); }}>Cancel</button>
                  <button type="button" onClick={saveTargets} disabled={saving}>{saving ? 'Saving...' : 'Save Targets'}</button>
                </span>
              )}
          </div>
          <table className="responsive" width="100%" cellPadding="6" style={{ marginTop: 8 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                <th>Salesperson</th><th>Target (RM)</th><th>Target (Sqm)</th>
              </tr>
            </thead>
            <tbody>
              {targets.map((t, i) => (
                <tr key={t.user_id} style={{ borderBottom: '1px solid #eee' }}>
                  <td data-label="Salesperson">{t.full_name}</td>
                  <td data-label="Target (RM)">
                    {editingTargets ? (
                      <input
                        type="number" min="0" step="1000" value={t.target_myr}
                        onChange={(e) => setTargets(targets.map((x, j) => (j === i ? { ...x, target_myr: e.target.value } : x)))}
                        style={{ width: 140 }}
                      />
                    ) : fmtMYR(t.target_myr)}
                  </td>
                  <td data-label="Target (Sqm)">
                    {editingTargets ? (
                      <input
                        type="number" min="0" step="10" value={t.target_sqm}
                        onChange={(e) => setTargets(targets.map((x, j) => (j === i ? { ...x, target_sqm: e.target.value } : x)))}
                        style={{ width: 100 }}
                      />
                    ) : fmtNum(t.target_sqm)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
