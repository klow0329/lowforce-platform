import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { computeChanges, confirmSave, ChangesBanner, fieldsetStyle } from '../utils/recordForm';
import { setUnsavedChanges } from '../utils/unsavedChanges';
import DeleteRecordButton from '../components/DeleteRecordButton';
import BillingTemplate from '../components/BillingTemplate';
import CorrespondenceLog from '../components/CorrespondenceLog';

const label = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, marginTop: 12 };
const inputStyle = { display: 'block', width: '100%', padding: 8, boxSizing: 'border-box' };
const fmt = (n, ccy = 'MYR') => `${ccy === 'USD' ? 'USD' : 'RM'} ${Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Confirming an invoice is Finance's call, and ONLY Finance's — not even
// Admin/Management, per explicit instruction — they're the ones reconciling
// invoice_no/date/exchange rate against the accounting system before it
// counts as final.
const CAN_CONFIRM_ROLES = ['FIN'];

const DOC_TYPE_LABELS = { E_INVOICE: 'E-Invoice', PAYMENT_PROOF: 'Proof of Payment', SUPPORTING_DOC: 'Supporting Document' };

export default function InvoiceDetail({ user }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const canConfirm = CAN_CONFIRM_ROLES.includes(user?.role_code);

  // Invoices are now system-generated as drafts from a contract (see
  // SalesOrderDetail's "Generate Draft Invoice(s)") — this screen is where
  // Finance reviews the draft, fills in the real date/invoice no./exchange
  // rate to match their accounting system, then commits it.
  const [form, setForm] = useState({
    invoice_no: '',
    invoice_date: '',
    exchange_rate: '',
    bill_to_type: 'BILLING',
  });
  const [invoice, setInvoice] = useState(null);
  const [balanceDue, setBalanceDue] = useState(0);
  const [balanceDueForeign, setBalanceDueForeign] = useState(0);
  const [payments, setPayments] = useState([]);
  const [contractItems, setContractItems] = useState([]);
  const [taxCodes, setTaxCodes] = useState([]);
  const [lodPct, setLodPct] = useState(15);
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadDocType, setUploadDocType] = useState('E_INVOICE');
  const [remarksDraft, setRemarksDraft] = useState('');
  const [savingRemarks, setSavingRemarks] = useState(false);
  const [original, setOriginal] = useState(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function loadAttachments() {
    if (!id) return;
    api.listInvoiceAttachments(id).then(({ attachments }) => setAttachments(attachments));
  }

  async function handleUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      setError('File is too large — the limit is 3MB. Please compress it and try again.');
      e.target.value = '';
      return;
    }
    setUploading(true);
    setError('');
    try {
      await api.uploadInvoiceAttachment(id, file, uploadDocType);
      loadAttachments();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handleAcknowledgeProof(att) {
    try {
      await api.acknowledgeInvoicePaymentProof(id, att.id);
      loadAttachments();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSaveRemarks() {
    setSavingRemarks(true);
    setError('');
    try {
      await api.updateInvoice(id, { remarks: remarksDraft });
      loadInvoice();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingRemarks(false);
    }
  }

  async function handleDeleteAttachment(att) {
    if (!window.confirm(`Delete ${att.original_filename}?`)) return;
    try {
      await api.deleteInvoiceAttachment(id, att.id);
      loadAttachments();
    } catch (err) {
      setError(err.message);
    }
  }

  function loadInvoice() {
    api.getInvoice(id).then(({ invoice }) => {
      const loaded = {
        invoice_no: invoice.invoice_no,
        invoice_date: invoice.invoice_date || '',
        exchange_rate: invoice.exchange_rate,
        bill_to_type: invoice.bill_to_type || 'BILLING',
      };
      setForm(loaded);
      setOriginal(loaded);
      setInvoice(invoice);
      setRemarksDraft(invoice.remarks || '');
      setBalanceDue(invoice.balance_due);
      setBalanceDueForeign(invoice.balance_due_foreign);
      // Locked by default regardless of status — Finance clicks Edit
      // explicitly (see item 7/9: invoice_no/date/rate stay editable to
      // Finance whether the invoice is still a draft or already confirmed;
      // nobody else, ever).
      setEditing(false);
      setLoading(false);
      // The contract's real billing breakdown — lets Finance cross-check
      // this invoice's amount against the actual line items it's a % of,
      // rather than confirming a lump sum on faith.
      api.listSalesOrderItems(invoice.sales_order_id).then(({ items }) => setContractItems(items));
    });
    api.listPayments(id).then(({ payments }) => setPayments(payments));
    api.listTaxCodes().then(({ taxCodes }) => setTaxCodes(taxCodes));
    api.getSettings().then(({ settings }) => setLodPct(settings?.lod_pct_of_bas ?? 15));
  }

  useEffect(() => {
    loadInvoice();
    loadAttachments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const changes = computeChanges(original, form);
  // amount_foreign itself is never edited here — it's fixed by the
  // contract's own billing (see item 7) — only the rate applied to it is.
  const amountMyr = Number(invoice?.amount_foreign || 0) * Number(form.exchange_rate || 1);

  // Warns before the user navigates away (nav bar links, tab close/refresh)
  // with unsaved edits — cleared on unmount so it never leaks onto the next
  // page after a confirmed discard or a successful Save.
  useEffect(() => {
    const isDirty = editing && changes.length > 0;
    setUnsavedChanges(isDirty, 'You have unsaved invoice changes that will be lost if you leave. Continue?');
    return () => setUnsavedChanges(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, changes.length]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!confirmSave(changes, 'invoice', false)) return;
    setSaving(true);
    try {
      await api.updateInvoice(id, form);
      loadInvoice();
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirm() {
    if (!window.confirm(`Confirm invoice ${form.invoice_no} at ${fmt(amountMyr)}? Once confirmed it counts as final.`)) return;
    setError('');
    setSaving(true);
    try {
      await api.updateInvoice(id, { ...form, status: 'CONFIRMED' });
      loadInvoice();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p style={{ maxWidth: 600, margin: '40px auto' }}>Loading...</p>;

  return (
    <div className="page" style={{ maxWidth: 600, margin: '40px auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          Invoice {invoice.invoice_no}
          <span style={{
            background: invoice.status === 'DRAFT' ? '#FFF3BF' : '#E3F6E8',
            color: invoice.status === 'DRAFT' ? '#8a6d1a' : '#1E7B34',
            padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600,
          }}>
            {invoice.status === 'DRAFT' ? 'DRAFT' : 'CONFIRMED'}
          </span>
        </h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {!editing && canConfirm && <button type="button" onClick={() => setEditing(true)}>Edit</button>}
          <button type="button" onClick={() => navigate(`/sales-orders/${invoice.sales_order_id}`)}>Back to Contract</button>
        </div>
      </div>
      {error && <p style={{ color: 'red', fontWeight: 600 }}>{error}</p>}

      <p style={{ color: '#5c6070' }}>{invoice.company_name}{invoice.billing_pct ? ` — Milestone ${Number(invoice.billing_pct)}% of contract` : ''}</p>

      <label style={label}>
        Remarks — shared with this deal's Opportunity and Contract; a change here updates those too.
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <textarea
          style={{ ...inputStyle, minHeight: 48, flex: 1 }} value={remarksDraft}
          onChange={(e) => setRemarksDraft(e.target.value)}
        />
        <button
          type="button" disabled={savingRemarks || remarksDraft === (invoice.remarks || '')}
          onClick={handleSaveRemarks} style={{ alignSelf: 'flex-start' }}
        >
          {savingRemarks ? 'Saving...' : 'Save'}
        </button>
      </div>

      {contractItems.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h3>Contract Billing Detail</h3>
          <p style={{ fontSize: 13, color: '#5c6070' }}>
            The full billing breakdown from the contract this invoice was generated from — cross-check the
            calculation here before confirming.
          </p>
          <BillingTemplate
            parentType="contract"
            parentId={invoice.sales_order_id}
            currency={invoice.currency}
            bookingType=""
            items={contractItems}
            priceList={[]}
            taxCodes={taxCodes}
            lodPct={lodPct}
            showSaveButton={false}
            readOnly
            onSaved={() => {}}
          />
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <fieldset disabled={!editing} style={fieldsetStyle}>
        <label style={label}>Invoice No.</label>
        <input style={inputStyle} value={form.invoice_no} onChange={(e) => set('invoice_no', e.target.value)} required />

        <label style={label}>Invoice Date</label>
        <input type="date" style={inputStyle} value={form.invoice_date} onChange={(e) => set('invoice_date', e.target.value)} />

        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={label}>Exchange Rate (1 {invoice.currency} = ? MYR)</label>
            <input type="number" step="0.0001" style={inputStyle} value={form.exchange_rate} onChange={(e) => set('exchange_rate', e.target.value)} required disabled={invoice.currency === 'MYR'} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={label}>Amount in MYR</label>
            <div style={{ ...inputStyle, background: '#F5F6FA', fontWeight: 600 }}>{fmt(amountMyr)}</div>
          </div>
        </div>
        {invoice.currency === 'USD' && (
          <p style={{ fontSize: 12, color: '#5c6070' }}>
            Enter the actual rate used for this invoice — installments on the same contract can carry different rates as the market moves. The {invoice.currency} amount itself is fixed by the contract's own billing.
          </p>
        )}

        <label style={label}>Bill To (recipient name on the printed invoice)</label>
        <select style={inputStyle} value={form.bill_to_type} onChange={(e) => set('bill_to_type', e.target.value)}>
          <option value="EXHIBITOR">Exhibitor Name — {invoice.company_name || '—'}</option>
          <option value="BILLING">Billing Company Name — {invoice.billing_name || invoice.company_name || '—'}</option>
          <option value="AGENT">Agent Name — {invoice.agent_name || '(no agent assigned)'}</option>
        </select>
        </fieldset>

        {editing && <ChangesBanner changes={changes} />}

        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          {editing && (
            <button type="submit" disabled={saving} style={{ padding: '8px 16px' }}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          )}
          {invoice.status === 'DRAFT' && canConfirm && (
            <button type="button" disabled={saving} onClick={handleConfirm} style={{ padding: '8px 16px' }}>
              Confirm Invoice
            </button>
          )}
          {invoice.status === 'DRAFT' && !canConfirm && (
            <span style={{ fontSize: 13, color: '#5c6070', alignSelf: 'center' }}>Waiting on Finance to confirm this invoice.</span>
          )}
          <button type="button" onClick={() => navigate(`/invoices/${id}/print`)} style={{ padding: '8px 16px' }}>
            View / Print Invoice
          </button>
          {user?.role_code === 'ADM' && (
            <DeleteRecordButton type="invoice" id={id} label="invoice" onDeleted={() => navigate(`/sales-orders/${invoice.sales_order_id}`)} />
          )}
        </div>
      </form>

      <div style={{ marginTop: 32 }}>
        <h3>Attachments</h3>
        <p style={{ fontSize: 13, color: '#5c6070' }}>
          Upload any related document for audit/reference — e.g. bank-in slip, e-invoice, correspondence. Max 3MB per file (compress first if needed).
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <select value={uploadDocType} onChange={(e) => setUploadDocType(e.target.value)} style={{ padding: 6 }}>
            {Object.entries(DOC_TYPE_LABELS).map(([code, docLabel]) => <option key={code} value={code}>{docLabel}</option>)}
          </select>
          <input type="file" onChange={handleUpload} disabled={uploading} />
        </div>
        <table width="100%" cellPadding="6" style={{ marginTop: 8 }}>
          <tbody>
            {attachments.map((att) => (
              <tr key={att.id} style={{ borderBottom: '1px solid #eee' }}>
                <td>
                  <a href={api.invoiceAttachmentDownloadUrl(id, att.id)} target="_blank" rel="noreferrer">{att.original_filename}</a>
                </td>
                <td style={{ fontSize: 12 }}>{DOC_TYPE_LABELS[att.doc_type] || att.doc_type}</td>
                <td style={{ fontSize: 12, color: '#5c6070' }}>{(att.size_bytes / 1024).toFixed(0)} KB · {att.uploaded_by_name} · {new Date(att.uploaded_at).toLocaleDateString()}</td>
                <td style={{ textAlign: 'right' }}>
                  {att.doc_type === 'PAYMENT_PROOF' && canConfirm && (
                    att.finance_acknowledged_at
                      ? <span style={{ fontSize: 11, color: '#1E7B34', marginRight: 8 }}>Acknowledged</span>
                      : <button type="button" onClick={() => handleAcknowledgeProof(att)} style={{ marginRight: 8 }}>Acknowledge</button>
                  )}
                  <button type="button" onClick={() => handleDeleteAttachment(att)}>Delete</button>
                </td>
              </tr>
            ))}
            {attachments.length === 0 && <tr><td>No attachments yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>Payments — Balance Due: {fmt(balanceDue)}</h3>
          {balanceDue > 0 && canConfirm && (
            <button
              type="button"
              onClick={() => {
                const params = new URLSearchParams({
                  exhibitor_id: invoice.exhibitor_id, exhibitor_name: invoice.company_name,
                  invoice_id: id, invoice_no: invoice.invoice_no, balance_due: balanceDue,
                  balance_due_foreign: balanceDueForeign, currency: invoice.currency, exchange_rate: invoice.exchange_rate,
                  event_id: invoice.event_id,
                });
                navigate(`/payments/new?${params}`);
              }}
            >
              Record Payment
            </button>
          )}
        </div>
        <table width="100%" cellPadding="6">
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
              <th>Receipt No</th>
              <th>Date</th>
              <th>Method</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr
                key={p.id}
                onClick={() => navigate(`/payments/${p.id}`)}
                style={{ borderBottom: '1px solid #eee', cursor: 'pointer' }}
              >
                <td>{p.receipt_no}</td>
                <td>{p.payment_date || '—'}</td>
                <td>{p.payment_method || '—'}</td>
                <td>
                  {fmt(p.allocated_amount_foreign, p.currency)}
                  {Number(p.payment_total_foreign) !== Number(p.allocated_amount_foreign) && (
                    <span style={{ fontSize: 11, color: '#5c6070' }}> (of {fmt(p.payment_total_foreign, p.currency)} received)</span>
                  )}
                </td>
              </tr>
            ))}
            {payments.length === 0 && (
              <tr><td colSpan={4}>No payments recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <CorrespondenceLog entityType="invoice" entityId={id} />
    </div>
  );
}
