import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useEventContext } from '../context/EventContext';

const fmtMYR = (n) => `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const tile = {
  flex: '1 1 160px',
  textAlign: 'left',
  padding: 12,
  border: '1px solid #ddd',
  borderRadius: 8,
  background: '#fff',
  cursor: 'pointer',
  color: '#202330', // cards are <button> elements; without this they inherit the global white button text
};
const tileLabel = { fontSize: 12, color: '#5c6070' };
const tileValue = { fontSize: 22, fontWeight: 700, color: '#1B3A6B' };

export default function Dashboard() {
  const { selectedEventId, loading: eventLoading } = useEventContext();
  const navigate = useNavigate();
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!selectedEventId) return;
    api.getDashboard(selectedEventId).then(setData);
  }, [selectedEventId]);

  if (eventLoading || (selectedEventId && !data)) return <p style={{ maxWidth: 900, margin: '40px auto' }}>Loading...</p>;
  if (!selectedEventId) {
    return <p style={{ maxWidth: 900, margin: '40px auto' }}>No events set up yet — create one in Admin first.</p>;
  }

  return (
    <div className="page" style={{ maxWidth: 900, margin: '40px auto' }}>
      <h2>Sales Dashboard</h2>

      <h3 style={{ fontSize: 14, color: '#5c6070', marginTop: 24 }}>Pipeline</h3>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button style={tile} onClick={() => navigate('/opportunities')}>
          <div style={tileLabel}>Total Opportunities</div>
          <div style={tileValue}>{data.opportunities.total}</div>
        </button>
        <button style={tile} onClick={() => navigate('/opportunities')}>
          <div style={tileLabel}>Active</div>
          <div style={tileValue}>{data.opportunities.active}</div>
        </button>
        <button style={{ ...tile, background: '#eafaf1' }} onClick={() => navigate('/opportunities')}>
          <div style={tileLabel}>Won</div>
          <div style={{ ...tileValue, color: '#1A9C5B' }}>{data.opportunities.won}</div>
        </button>
        <button style={{ ...tile, background: '#fdecec' }} onClick={() => navigate('/opportunities')}>
          <div style={tileLabel}>Lost</div>
          <div style={{ ...tileValue, color: '#D13434' }}>{data.opportunities.lost}</div>
        </button>
        <button style={tile} onClick={() => navigate('/opportunities')}>
          <div style={tileLabel}>Conversion Rate</div>
          <div style={tileValue}>{data.opportunities.conversionRatePct.toFixed(1)}%</div>
        </button>
        <button
          style={{ ...tile, border: data.followUpsDue > 0 ? '2px solid #F47920' : tile.border }}
          onClick={() => navigate('/opportunities')}
        >
          <div style={tileLabel}>Follow-Ups Due</div>
          <div style={{ ...tileValue, color: data.followUpsDue > 0 ? '#F47920' : 'inherit' }}>{data.followUpsDue}</div>
        </button>
        <button style={tile} onClick={() => navigate('/opportunities')} title="Bare Space, Shell Scheme, Enhanced Shell, Walk-On Package and Custom Build only">
          <div style={tileLabel}>Total Booths (Won)</div>
          <div style={tileValue}>{data.totalBooths.count}</div>
          <div style={tileLabel}>{data.totalBooths.totalSqm} sqm</div>
        </button>
      </div>

      <h3 style={{ fontSize: 14, color: '#5c6070', marginTop: 24 }}>Finance</h3>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button style={tile} onClick={() => navigate('/sales-orders')}>
          <div style={tileLabel}>Total Contract Value</div>
          <div style={tileValue}>{fmtMYR(data.totalContractValue)}</div>
        </button>
        <button style={tile} onClick={() => navigate('/sales-orders')}>
          <div style={tileLabel}>Contracted, Not Yet Invoiced</div>
          <div style={tileValue}>{data.contractedNotInvoiced.count}</div>
          <div style={tileLabel}>{fmtMYR(data.contractedNotInvoiced.totalValue)}</div>
        </button>
        <button style={tile} onClick={() => navigate('/invoices')}>
          <div style={tileLabel}>Total Invoiced</div>
          <div style={tileValue}>{fmtMYR(data.totalInvoiced)}</div>
        </button>
        <button style={{ ...tile, background: '#eafaf1' }} onClick={() => navigate('/invoices')}>
          <div style={tileLabel}>Total Collected</div>
          <div style={{ ...tileValue, color: '#1A9C5B' }}>{fmtMYR(data.totalCollected)}</div>
        </button>
        <button style={{ ...tile, background: data.totalOutstanding > 0 ? '#fdecec' : '#fff' }} onClick={() => navigate('/customer-aging')}>
          <div style={tileLabel}>Total Outstanding</div>
          <div style={{ ...tileValue, color: data.totalOutstanding > 0 ? '#D13434' : 'inherit' }}>{fmtMYR(data.totalOutstanding)}</div>
        </button>
      </div>
    </div>
  );
}
