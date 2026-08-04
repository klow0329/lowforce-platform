import { useEffect, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from 'recharts';
import { api } from '../../api/client';
import { useEventContext } from '../../context/EventContext';
import DataTable from '../../components/DataTable';
import { fmtNum, NAVY, ACCENT_BLUE, GREEN, tile, tileLabel, tileValue } from './fmt';

// Physical floor space, not revenue — how much of the hall is actually
// taken, by whom, and as what booth type. Sourced from the Floor Plan's own
// booth records (see performance.controller.js's getBoothSpace), so it
// reconciles with the per-hall tallies on the Floor Plan screen rather than
// with the billing line items.
export default function PerfBoothSpace() {
  const { selectedEventId } = useEventContext();
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!selectedEventId) return;
    setData(null);
    api.getPerfBoothSpace(selectedEventId).then(setData);
  }, [selectedEventId]);

  if (!data) return <p>Loading...</p>;

  const t = data.totals;
  const local = data.byCountry.filter((r) => r.type === 'LOCAL');
  const intl = data.byCountry.filter((r) => r.type === 'INT');
  const sumBy = (arr, k) => arr.reduce((acc, r) => acc + r[k], 0);
  const pctOfAllocated = (v) => (t.allocatedSqm > 0 ? `${((v / t.allocatedSqm) * 100).toFixed(1)}%` : '—');
  const takeUp = t.totalSqm > 0 ? ((t.allocatedSqm / t.totalSqm) * 100).toFixed(1) : null;

  // Top 12 by sqm keeps the chart readable; the full list is in the table.
  const countryChart = data.byCountry.slice(0, 12).map((r) => ({
    name: r.code === '—' ? '?' : r.code,
    Contracted: r.contracted_sqm,
    Proposed: r.sqm - r.contracted_sqm,
  }));

  const typeChart = data.byType.map((r) => ({
    name: r.item_code,
    Local: r.local_sqm,
    International: r.int_sqm,
  }));

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Booth &amp; Space Analysis</h2>
      <p style={{ fontSize: 13, color: '#5c6070', marginTop: 0 }}>
        Physical floor space taken from the Floor Plan — every allocated booth counted once, at its own sqm.
        &ldquo;Contracted&rdquo; is space held by a Contract; &ldquo;Proposed&rdquo; is space an Opportunity is still holding.
      </p>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={tile}>
          <div style={tileLabel}>Space Allocated</div>
          <div style={tileValue}>
            {fmtNum(t.allocatedSqm)} <span style={{ fontSize: 14 }}>/ {fmtNum(t.totalSqm)} sqm</span>
          </div>
          <div style={tileLabel}>{takeUp !== null ? `${takeUp}% take-up` : 'No booths set up yet'}</div>
        </div>
        <div style={tile}>
          <div style={tileLabel}>Booths Allocated</div>
          <div style={tileValue}>
            {fmtNum(t.allocatedBooths)} <span style={{ fontSize: 14 }}>/ {fmtNum(t.totalBooths)}</span>
          </div>
          <div style={tileLabel}>{fmtNum(t.totalBooths - t.allocatedBooths)} still open</div>
        </div>
        <div style={tile}>
          <div style={tileLabel}>Contracted</div>
          <div style={tileValue}>{fmtNum(t.contractedSqm)} sqm</div>
          <div style={tileLabel}>{fmtNum(t.contractedBooths)} booths</div>
        </div>
        <div style={tile}>
          <div style={tileLabel}>Proposed</div>
          <div style={tileValue}>{fmtNum(t.proposedSqm)} sqm</div>
          <div style={tileLabel}>{fmtNum(t.proposedBooths)} booths</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
        <div style={tile}>
          <div style={tileLabel}>Local (Malaysia)</div>
          <div style={tileValue}>
            {fmtNum(sumBy(local, 'sqm'))} sqm <span style={{ fontSize: 14 }}>({pctOfAllocated(sumBy(local, 'sqm'))})</span>
          </div>
          <div style={tileLabel}>{fmtNum(sumBy(local, 'booths'))} booths · {local.length} countr{local.length === 1 ? 'y' : 'ies'}</div>
        </div>
        <div style={tile}>
          <div style={tileLabel}>International</div>
          <div style={tileValue}>
            {fmtNum(sumBy(intl, 'sqm'))} sqm <span style={{ fontSize: 14 }}>({pctOfAllocated(sumBy(intl, 'sqm'))})</span>
          </div>
          <div style={tileLabel}>{fmtNum(sumBy(intl, 'booths'))} booths · {intl.length} countr{intl.length === 1 ? 'y' : 'ies'}</div>
        </div>
      </div>

      <h3>Space by Country (sqm)</h3>
      <div style={{ height: 280, marginBottom: 24 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={countryChart}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip formatter={(v) => `${fmtNum(v)} sqm`} />
            <Legend />
            <Bar dataKey="Contracted" stackId="a" fill={NAVY} />
            <Bar dataKey="Proposed" stackId="a" fill={ACCENT_BLUE} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <DataTable
        screenKey="report-booth-space-country"
        columns={[
          { key: 'country', label: 'Country', default: true },
          { key: 'code', label: 'Code', default: false },
          { key: 'type', label: 'Local/Int', default: true, value: (r) => (r.type === 'LOCAL' ? 'Local' : 'International') },
          { key: 'booths', label: 'Booths', default: true, value: (r) => fmtNum(r.booths) },
          { key: 'sqm', label: 'Sqm', default: true, value: (r) => fmtNum(r.sqm) },
          { key: 'contracted_booths', label: 'Contracted Booths', default: true, value: (r) => fmtNum(r.contracted_booths) },
          { key: 'contracted_sqm', label: 'Contracted Sqm', default: true, value: (r) => fmtNum(r.contracted_sqm) },
          { key: 'share', label: '% of Space', default: true, value: (r) => pctOfAllocated(r.sqm) },
        ]}
        rows={data.byCountry}
        getRowKey={(r) => r.code}
        exportFilename="booth-space-by-country"
        exportSheetName="By Country"
      />

      <h3 style={{ marginTop: 32 }}>Space by Booth Type (sqm)</h3>
      <div style={{ height: 260, marginBottom: 24 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={typeChart}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip formatter={(v) => `${fmtNum(v)} sqm`} />
            <Legend />
            <Bar dataKey="Local" stackId="b" fill={NAVY} />
            <Bar dataKey="International" stackId="b" fill={GREEN} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <DataTable
        screenKey="report-booth-space-type"
        columns={[
          { key: 'item_code', label: 'Code', default: true },
          { key: 'description', label: 'Booth Type', default: true },
          { key: 'booths', label: 'Booths', default: true, value: (r) => fmtNum(r.booths) },
          { key: 'sqm', label: 'Sqm', default: true, value: (r) => fmtNum(r.sqm) },
          { key: 'local_sqm', label: 'Local Sqm', default: true, value: (r) => fmtNum(r.local_sqm) },
          { key: 'int_sqm', label: 'Int. Sqm', default: true, value: (r) => fmtNum(r.int_sqm) },
          { key: 'contracted_sqm', label: 'Contracted Sqm', default: true, value: (r) => fmtNum(r.contracted_sqm) },
          { key: 'share', label: '% of Space', default: true, value: (r) => pctOfAllocated(r.sqm) },
        ]}
        rows={data.byType}
        getRowKey={(r) => r.item_code}
        exportFilename="booth-space-by-type"
        exportSheetName="By Booth Type"
      />
    </div>
  );
}
