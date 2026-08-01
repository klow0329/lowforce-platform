import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useEventContext } from '../context/EventContext';
import DataTable from '../components/DataTable';

const fmtMYR = (n) => `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Contract-level view of the same balances as CustomerAging.jsx (invoice
// level) — one row per Contract instead of one row per Invoice, per the
// user's explicit request (2026-07-31): "Customer Aging based on Contract".
// Kept alongside, not replacing, the invoice-level report — that one stays
// the tool for per-invoice detail/correspondence; clicking a row here drills
// into it, filtered to just this contract's invoices.
export default function ContractAging({ embedded = false }) {
  const { selectedEventId, loading: eventLoading } = useEventContext();
  const navigate = useNavigate();
  const [report, setReport] = useState(null);

  useEffect(() => {
    if (!selectedEventId) return;
    api.getCustomerAgingByContract(selectedEventId).then(setReport);
  }, [selectedEventId]);

  if (eventLoading || (selectedEventId && !report)) return <p style={{ maxWidth: 1000, margin: '40px auto' }}>Loading...</p>;
  if (!selectedEventId) {
    return <p style={{ maxWidth: 1000, margin: '40px auto' }}>No events set up yet — create one in Admin first.</p>;
  }

  const columns = [
    { key: 'exhibitor_name', label: 'Company', default: true },
    { key: 'salesperson_name', label: 'Salesperson', default: true, value: (r) => r.salesperson_name || '—' },
    { key: 'agent_name', label: 'Agent', default: false, value: (r) => r.agent_name || '—' },
    { key: 'contract_date', label: 'Contract Date', default: true },
    { key: 'total_contracted_value', label: 'Total Contracted Value', default: true, value: (r) => fmtMYR(r.total_contracted_value) },
    { key: 'collected_value', label: 'Collected Value', default: true, value: (r) => fmtMYR(r.collected_value) },
    { key: 'due_amount', label: 'Due Amount', default: true, value: (r) => fmtMYR(r.due_amount) },
    { key: 'days_overdue', label: 'Days Overdue', default: true },
    { key: 'not_invoiced_amount', label: 'Not Yet Invoiced', default: true, value: (r) => fmtMYR(r.not_invoiced_amount) },
    { key: 'not_due_yet', label: 'Not Due Yet', default: true, value: (r) => fmtMYR(r.not_due_yet) },
    { key: 'balance_total_due', label: 'Balance Total Due', default: true, value: (r) => fmtMYR(r.balance_total_due) },
    {
      key: 'expected_payment', label: 'Expected Payment', default: true,
      value: (r) => (r.expected_payment ? r.expected_payment : '—'),
    },
  ];

  return (
    <div className={embedded ? '' : 'page'} style={embedded ? {} : { maxWidth: 1000, margin: '40px auto' }}>
      <h2 style={embedded ? { marginTop: 0 } : {}}>Customer Aging by Contract</h2>
      <p style={{ fontSize: 13, color: '#5c6070' }}>
        One row per approved Contract with an outstanding balance — payment terms come from the contract's own Credit Term.
        Click a row for the invoice-level detail and correspondence log for that contract.
      </p>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '16px 0 24px' }}>
        <div className="card-tile" style={{ flex: '1 1 140px', padding: 12, border: '1px solid #ddd', borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: '#5c6070' }}>Total Outstanding</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{fmtMYR(report.totalOutstanding)}</div>
          <div style={{ fontSize: 12, color: '#5c6070' }}>{report.contracts.length} contract{report.contracts.length === 1 ? '' : 's'}</div>
        </div>
      </div>

      <DataTable
        screenKey="contract-aging"
        columns={columns}
        rows={report.contracts}
        getRowKey={(r) => r.id}
        onRowClick={(r) => navigate(`/reports/aging?sales_order_id=${r.id}`)}
        exportFilename="customer-aging-by-contract"
        exportSheetName="Customer Aging by Contract"
      />
    </div>
  );
}
