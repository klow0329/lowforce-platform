import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useEventContext } from '../context/EventContext';
import DataTable from '../components/DataTable';
import InfoTooltip from '../components/InfoTooltip';

const fmtMYR = (n) => `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const CN_STATUS_LABELS = {
  PENDING_APPROVAL: 'Pending Approval',
  DRAFT: 'Awaiting Finance Confirm',
  CONFIRMED: 'Confirmed',
  REJECTED: 'Rejected',
};

// Finance had no standalone place to find Credit Notes other than the
// Dashboard to-do widget (per the user's explicit request, 2026-07-31) —
// merging CN rows into this same list, distinguished by a Type column, put
// them somewhere findable without adding a whole new nav item. Each row
// still carries its own doc_no/date/status/amount shape so the existing
// columns work for both; the Type column and row click route each to its
// own detail page.
export default function InvoicesList() {
  const { selectedEventId, loading: eventLoading } = useEventContext();
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState([]);
  const [creditNotes, setCreditNotes] = useState([]);
  const [search, setSearch] = useState('');

  const columns = [
    {
      key: 'doc_type', label: 'Type', default: true,
      render: (r) => (
        <span style={{
          fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
          background: r.doc_type === 'CN' ? '#FBE3E3' : '#E3F2FD',
          color: r.doc_type === 'CN' ? '#c83c3c' : '#1B3A6B',
        }}>
          {r.doc_type}
        </span>
      ),
    },
    { key: 'doc_no', label: 'Doc No', default: true },
    { key: 'exhibitor_name', label: 'Company', default: true },
    { key: 'doc_date', label: 'Date', default: true },
    { key: 'status_label', label: 'Status', default: true },
    {
      key: 'exchange_rate', label: 'Currency Rate', default: true,
      value: (r) => (r.doc_type === 'INV' && r.currency === 'USD' ? Number(r.exchange_rate) : 1),
      render: (r) => (r.doc_type === 'INV' && r.currency === 'USD' ? Number(r.exchange_rate).toFixed(4) : '—'),
    },
    {
      key: 'amount_foreign', label: 'Doc Currency', default: true,
      value: (r) => (r.doc_type === 'INV' ? Number(r.amount_foreign) : 0),
      render: (r) => (r.doc_type === 'INV' ? `${r.currency} ${Number(r.amount_foreign).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'),
    },
    {
      key: 'amount_myr', label: 'Local Currency', default: true,
      value: (r) => fmtMYR(r.amount_myr),
      render: (r) => (r.doc_type === 'CN' ? `− ${fmtMYR(r.amount_myr)}` : fmtMYR(r.amount_myr)),
    },
    {
      key: 'payment_status', label: 'Payment', default: true,
      // Shows the actual amount still owed, not just the word "Outstanding"
      // — a partially-paid invoice (e.g. RM5,000 paid off a RM12,000
      // invoice) needs the real RM7,000 balance visible here, not just a
      // status label that hides how much is actually left. Credit Notes
      // don't carry their own outstanding balance the same way, so this
      // column is invoice-only.
      value: (r) => (r.doc_type === 'INV' ? Number(r.balance_due) || 0 : 0),
      render: (r) => {
        if (r.doc_type === 'CN') return <span style={{ color: '#5c6070' }}>—</span>;
        if (r.status === 'DRAFT') return <span style={{ color: '#5c6070' }}>—</span>;
        const balance = Number(r.balance_due) || 0;
        const outstanding = balance > 0.01;
        return (
          <span
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/customer-aging?exhibitor=${encodeURIComponent(r.exhibitor_name)}`);
            }}
            style={{
              color: outstanding ? '#c83c3c' : '#1E7B34', fontWeight: 600,
              cursor: outstanding ? 'pointer' : 'default', textDecoration: outstanding ? 'underline' : 'none',
            }}
            title={outstanding ? 'Go to Customer Aging' : undefined}
          >
            {outstanding ? `${fmtMYR(balance)} outstanding` : 'Paid'}
          </span>
        );
      },
    },
  ];

  useEffect(() => {
    if (!selectedEventId) return;
    api.listInvoices({ event_id: selectedEventId, search }).then(({ invoices }) => setInvoices(invoices));
    api.listCreditNotes({ event_id: selectedEventId }).then(({ creditNotes }) => setCreditNotes(creditNotes));
  }, [selectedEventId, search]);

  const invoiceRows = invoices.map((inv) => ({
    ...inv, doc_type: 'INV', doc_no: inv.invoice_no, doc_date: inv.invoice_date,
    status_label: inv.status === 'DRAFT' ? 'Draft' : 'Confirmed',
  }));
  const creditNoteRows = creditNotes
    .filter((cn) => !search || cn.exhibitor_name.toLowerCase().includes(search.toLowerCase()))
    .map((cn) => ({
      ...cn, id: cn.id, doc_type: 'CN', doc_no: cn.cn_no, doc_date: cn.cn_date,
      status_label: CN_STATUS_LABELS[cn.status] || cn.status,
    }));
  const rows = [...invoiceRows, ...creditNoteRows].sort((a, b) => (b.doc_date || '').localeCompare(a.doc_date || ''));

  if (eventLoading) return <p style={{ maxWidth: 800, margin: '40px auto' }}>Loading...</p>;
  if (!selectedEventId) {
    return <p style={{ maxWidth: 800, margin: '40px auto' }}>No events set up yet — create one in Admin first.</p>;
  }

  return (
    <div className="page" style={{ maxWidth: 800, margin: '40px auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          Invoices &amp; Credit Notes
          <InfoTooltip text={'Invoices are generated from a contract — open the contract and use "Generate Draft Invoice(s)". Credit Notes are requested from a contract\'s "Request Contract Reduction" flow — this list is where Finance finds one to confirm without going through the Dashboard to-do widget.'} />
        </h2>
      </div>

      <input
        placeholder="Search company name..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ width: '100%', padding: 8, margin: '16px 0', boxSizing: 'border-box' }}
      />

      <DataTable
        screenKey="invoices"
        columns={columns}
        rows={rows}
        getRowKey={(r) => `${r.doc_type}-${r.id}`}
        onRowClick={(r) => navigate(r.doc_type === 'CN' ? `/credit-notes/${r.id}` : `/invoices/${r.id}`)}
        exportFilename="invoices-and-credit-notes"
        exportSheetName="Invoices and Credit Notes"
      />
    </div>
  );
}
