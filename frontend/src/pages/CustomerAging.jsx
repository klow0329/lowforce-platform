import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useEventContext } from '../context/EventContext';
import DataTable from '../components/DataTable';
import EmailDraftPanel from '../components/EmailDraftPanel';

const fmtMYR = (n) => `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// stopPropagation on both cells — the row itself navigates to the invoice
// on click, which would otherwise fire every time someone tries to edit
// these fields inline.
function EditableDate({ value, onSave }) {
  return (
    <input
      type="date"
      defaultValue={value || ''}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onSave(e.target.value)}
      style={{ fontSize: 12, padding: 3 }}
    />
  );
}

// embedded: rendered inside the Reports shell, which already provides the
// page container — skip the standalone wrapper to avoid double margins.
export default function CustomerAging({ embedded = false, user }) {
  const { selectedEventId, loading: eventLoading } = useEventContext();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [report, setReport] = useState(null);
  const [bucketFilter, setBucketFilter] = useState('');
  const [company, setCompany] = useState(null);
  const [emailPanel, setEmailPanel] = useState(null); // { templateKey, vars } | null
  const exhibitorFilter = searchParams.get('exhibitor') || '';
  const contractFilter = searchParams.get('sales_order_id') || '';

  useEffect(() => {
    if (!selectedEventId) return;
    api.getCustomerAging(selectedEventId).then(setReport);
  }, [selectedEventId]);

  useEffect(() => {
    api.getCompany().then(({ company }) => setCompany(company));
  }, []);

  function draftReminder(invoice) {
    setEmailPanel({
      templateKey: 'OUTSTANDING_REMINDER',
      vars: {
        exhibitor_name: invoice.exhibitor_name, invoice_no: invoice.invoice_no,
        due_date: invoice.due_date || '', balance_amount: fmtMYR(invoice.balance_due),
        sender_name: user?.full_name || '', company_name: company?.name || '',
      },
    });
  }

  function draftStatement() {
    const total = visibleInvoices.reduce((sum, inv) => sum + Number(inv.balance_due || 0), 0);
    setEmailPanel({
      templateKey: 'STATEMENT_OF_ACCOUNT',
      vars: {
        exhibitor_name: exhibitorFilter, as_of_date: new Date().toLocaleDateString('en-MY', { dateStyle: 'medium' }),
        balance_amount: fmtMYR(total), sender_name: user?.full_name || '', company_name: company?.name || '',
      },
    });
  }

  async function handleUpdateAging(invoiceId, payload) {
    await api.updateInvoice(invoiceId, payload);
    setReport((r) => ({
      ...r,
      invoices: r.invoices.map((inv) =>
        inv.id === invoiceId ? { ...inv, ...payload, aging_updated_at: new Date().toISOString() } : inv
      ),
    }));
  }

  if (eventLoading || (selectedEventId && !report)) return <p style={{ maxWidth: 900, margin: '40px auto' }}>Loading...</p>;
  if (!selectedEventId) {
    return <p style={{ maxWidth: 900, margin: '40px auto' }}>No events set up yet — create one in Admin first.</p>;
  }

  const columns = [
    { key: 'exhibitor_name', label: 'Company', default: true },
    {
      key: 'billing_name', label: 'Billing Name', default: false,
      value: (r) => (r.billing_name && r.billing_name !== r.exhibitor_name ? r.billing_name : '—'),
    },
    { key: 'salesperson_name', label: 'Salesperson', default: true, value: (r) => r.salesperson_name || '—' },
    { key: 'agent_name', label: 'Agent', default: false, value: (r) => r.agent_name || '—' },
    { key: 'invoice_no', label: 'Invoice No', default: true },
    { key: 'invoice_date', label: 'Invoice Date', default: true },
    { key: 'due_date', label: 'Due Date', default: true },
    { key: 'days_overdue', label: 'Days Overdue', default: true },
    { key: 'bucket_label', label: 'Bucket', default: true },
    { key: 'balance_due', label: 'Balance', default: true, value: (r) => fmtMYR(r.balance_due) },
    {
      key: 'expected_payment_date', label: 'Expected Payment', default: true,
      value: (r) => <EditableDate value={r.expected_payment_date} onSave={(v) => handleUpdateAging(r.id, { expected_payment_date: v })} />,
    },
    {
      // Latest correspondence log entry (see CorrespondenceLog.jsx on the
      // Invoice detail page, where the full history lives and new entries
      // get added) — clicking this cell falls through to the row click,
      // same as every other column here, and lands you on that page.
      key: 'latest_correspondence', label: 'Correspondence', default: true,
      value: (r) => (r.latest_correspondence || '—'),
      render: (r) => (r.latest_correspondence ? (
        <span title={new Date(r.latest_correspondence_at).toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' })}>
          {r.latest_correspondence}
        </span>
      ) : <span style={{ color: '#5c6070' }}>—</span>),
    },
    {
      key: 'aging_updated_at', label: 'Last Updated', default: true,
      value: (r) => (r.aging_updated_at ? new Date(r.aging_updated_at).toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' }) : '—'),
    },
    {
      key: '_actions', label: '', default: true,
      render: (r) => (
        <button type="button" onClick={(e) => { e.stopPropagation(); draftReminder(r); }} style={{ fontSize: 12 }}>
          Draft Reminder
        </button>
      ),
    },
  ];

  let visibleInvoices = bucketFilter
    ? report.invoices.filter((inv) => inv.bucket_label === bucketFilter)
    : report.invoices;
  if (exhibitorFilter) {
    visibleInvoices = visibleInvoices.filter((inv) => inv.exhibitor_name === exhibitorFilter);
  }
  if (contractFilter) {
    visibleInvoices = visibleInvoices.filter((inv) => inv.sales_order_id === contractFilter);
  }

  return (
    <div className={embedded ? '' : 'page'} style={embedded ? {} : { maxWidth: 900, margin: '40px auto' }}>
      <h2 style={embedded ? { marginTop: 0 } : {}}>Customer Aging</h2>
      {exhibitorFilter && (
        <p style={{ fontSize: 13 }}>
          Filtered to <strong>{exhibitorFilter}</strong>{' '}
          <button type="button" onClick={() => setSearchParams({})} style={{ fontSize: 12 }}>Clear</button>{' '}
          <button type="button" onClick={draftStatement} style={{ fontSize: 12 }}>Draft Statement Email</button>
        </p>
      )}
      {contractFilter && (
        <p style={{ fontSize: 13 }}>
          Filtered to this contract's invoices only{' '}
          <button type="button" onClick={() => setSearchParams({})} style={{ fontSize: 12 }}>Clear</button>
        </p>
      )}
      {emailPanel && (
        <EmailDraftPanel templateKey={emailPanel.templateKey} vars={emailPanel.vars} onClose={() => setEmailPanel(null)} />
      )}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '16px 0 24px' }}>
        {report.summary.map((b) => (
          <button
            key={b.label}
            className="card-tile"
            onClick={() => setBucketFilter(bucketFilter === b.label ? '' : b.label)}
            style={{
              flex: '1 1 140px',
              textAlign: 'left',
              padding: 12,
              border: bucketFilter === b.label ? '2px solid #1B3A6B' : '1px solid #ddd',
              background: b.totalBalance > 0 ? '#fdecec' : '#fff',
            }}
          >
            <div style={{ fontSize: 12, color: '#5c6070' }}>{b.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{fmtMYR(b.totalBalance)}</div>
            <div style={{ fontSize: 12, color: '#5c6070' }}>{b.count} invoice{b.count === 1 ? '' : 's'}</div>
          </button>
        ))}
        <div className="card-tile" style={{ flex: '1 1 140px', padding: 12, border: '1px solid #ddd', borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: '#5c6070' }}>Total Outstanding</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{fmtMYR(report.totalOutstanding)}</div>
          <div style={{ fontSize: 12, color: '#5c6070' }}>{report.invoices.length} invoice{report.invoices.length === 1 ? '' : 's'}</div>
        </div>
      </div>

      <DataTable
        screenKey="customer-aging"
        columns={columns}
        rows={visibleInvoices}
        getRowKey={(r) => r.id}
        onRowClick={(r) => navigate(`/invoices/${r.id}`)}
        exportFilename="customer-aging"
        exportSheetName="Customer Aging"
      />
    </div>
  );
}
