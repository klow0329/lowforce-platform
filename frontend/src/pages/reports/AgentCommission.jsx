import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useEventContext } from '../../context/EventContext';
import DataTable from '../../components/DataTable';
import { fmtPct, NAVY, tile, tileLabel, tileValue } from './fmt';

const fmtCcy = (n, ccy) =>
  `${ccy} ${Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function AgentCommission() {
  const { selectedEventId } = useEventContext();
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!selectedEventId) return;
    setData(null);
    api.getAgentCommission(selectedEventId).then(setData);
  }, [selectedEventId]);

  if (!data) return <p>Loading...</p>;

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Agent Commission</h2>
      <p style={{ fontSize: 12, color: '#5c6070', marginTop: 0, marginBottom: 12 }}>
        Computed against CONFIRMED invoices only, in the same currency the invoice was issued in (never converted).
        Rates are set per agent, per item category, per repeat/new exhibitor tier under Sales Agents &gt; Commission
        Rates. Repeat vs new is driven by the exhibitor's "Repeat Exhibitor" flag (Admin &gt; Segments &gt; Repeat
        Exhibitor Import, or set by hand on the exhibitor's own record).
      </p>

      {data.agentSummary.length === 0 ? (
        <p>No commission-earning invoices yet for this event.</p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          {data.agentSummary.map((a) => (
            <div key={a.agent_id} style={{ ...tile, flex: '1 1 220px' }}>
              <div style={{ ...tileLabel, fontWeight: 600, color: NAVY }}>{a.agent_name}</div>
              {Object.entries(a.byCurrency).map(([ccy, amt]) => (
                <div key={ccy} style={tileValue}>{fmtCcy(amt, ccy)}</div>
              ))}
            </div>
          ))}
        </div>
      )}

      <DataTable
        screenKey="perf-agent-commission"
        columns={[
          { key: 'agent_name', label: 'Agent' },
          { key: 'exhibitor_name', label: 'Exhibitor' },
          { key: 'is_repeat_exhibitor', label: 'Tier', render: (r) => (r.is_repeat_exhibitor ? 'Repeat' : 'New') },
          { key: 'invoice_no', label: 'Invoice' },
          { key: 'invoice_amount', label: 'Invoice Amount', render: (r) => fmtCcy(r.invoice_amount, r.currency) },
          {
            key: 'breakdown',
            label: 'Rate Applied',
            render: (r) => (r.breakdown.length === 0 ? '—' : r.breakdown.map((b) => `${b.category} ${fmtPct(b.rate_pct)}`).join(', ')),
          },
          { key: 'commission', label: 'Commission', render: (r) => fmtCcy(r.commission, r.currency) },
        ]}
        rows={data.rows}
        getRowKey={(r) => r.invoice_id}
        exportFilename="agent-commission"
        exportSheetName="Agent Commission"
      />
    </div>
  );
}
