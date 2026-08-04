import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import BillingTemplate from '../components/BillingTemplate';
import DeleteRecordButton from '../components/DeleteRecordButton';

const label = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, marginTop: 12 };
const fmt = (n) => `RM ${Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS_STYLE = {
  PENDING_APPROVAL: { bg: '#FFF3BF', color: '#8a6d1a', label: 'Pending Approval' },
  DRAFT: { bg: '#E3F2FD', color: '#1B3A6B', label: 'Draft — Awaiting Finance Confirm' },
  CONFIRMED: { bg: '#E3F6E8', color: '#1E7B34', label: 'Confirmed' },
  REJECTED: { bg: '#FBE3E3', color: '#c83c3c', label: 'Rejected' },
};

// Follows the same issue -> attach -> Finance-confirm process as an
// Invoice (see InvoiceDetail.jsx) — this is the CN's own dedicated detail
// page, reachable as soon as a request is APPROVED (status DRAFT), not just
// after Finance later confirms it. Approve/Reject/Withdraw for a still-
// PENDING_APPROVAL request also live here rather than inline on the
// Contract page, matching how Invoice actions live on InvoiceDetail.jsx.
export default function CreditNoteDetail({ user }) {
  const { id } = useParams();
  const navigate = useNavigate();

  const [cn, setCn] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [taxCodes, setTaxCodes] = useState([]);
  const [lodPct, setLodPct] = useState(15);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showWithdrawChoice, setShowWithdrawChoice] = useState(false);

  function load() {
    api.getCreditNote(id).then(({ creditNote }) => {
      setCn(creditNote);
      setLoading(false);
    });
    api.listCreditNoteAttachments(id)
      .then(({ attachments }) => setAttachments(attachments))
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    load();
    api.listTaxCodes().then(({ taxCodes }) => setTaxCodes(taxCodes));
    api.getSettings().then(({ settings }) => setLodPct(settings?.lod_pct_of_bas ?? 15));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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
      await api.uploadCreditNoteAttachment(id, file);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handleDeleteAttachment(att) {
    if (!window.confirm(`Delete ${att.original_filename}?`)) return;
    try {
      await api.deleteCreditNoteAttachment(id, att.id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleApprove() {
    if (!window.confirm(`Approve this credit note for ${fmt(cn.amount_myr)}? The contract's committed sqm/items will update to match, and the released booth(s) will open up.`)) return;
    setBusy(true);
    setError('');
    try {
      await api.approveCreditNote(id);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    const notes = window.prompt('Reason for rejecting this credit note request:');
    if (notes === null) return;
    setBusy(true);
    setError('');
    try {
      await api.rejectCreditNote(id, { notes });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm() {
    if (!window.confirm(`Confirm this credit note? This is what actually reduces invoice ${cn.invoice_no}'s outstanding balance.`)) return;
    setBusy(true);
    setError('');
    try {
      await api.confirmCreditNote(id);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function handleEditNow() {
    navigate(`/sales-orders/${cn.sales_order_id}`, { state: { editCn: cn } });
  }

  async function handleDeletePermanently() {
    if (!window.confirm('Permanently delete this credit note request? This cannot be undone — all data reverts to before this request (nothing was ever changed on the contract or Floor Plan, since that only happens once approved).')) return;
    setBusy(true);
    setError('');
    try {
      await api.deleteCreditNote(id);
      navigate(`/sales-orders/${cn.sales_order_id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function handleAcknowledge() {
    try {
      await api.acknowledgeCnConfirm(id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading || !cn) return <p style={{ maxWidth: 700, margin: '40px auto' }}>Loading...</p>;

  const canActOnCn = ['ADM', 'MGT', 'FIN'].includes(user?.role_code); // best-effort hint; the backend is the real gate for a tiered-matrix approver who isn't one of these roles
  const canWithdraw = cn.status === 'PENDING_APPROVAL' && (cn.requested_by === user?.id || canActOnCn);
  const canConfirm = user?.role_code === 'FIN';
  const style = STATUS_STYLE[cn.status] || { bg: '#F5F6FA', color: '#5c6070', label: cn.status };

  return (
    <div className="page" style={{ maxWidth: 700, margin: '40px auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          Credit Note {cn.cn_no || '(pending approval)'}
          <span style={{ background: style.bg, color: style.color, padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600 }}>
            {style.label}
          </span>
        </h2>
        <button type="button" onClick={() => navigate(`/sales-orders/${cn.sales_order_id}`)}>Back to Contract</button>
      </div>

      <p style={{ color: '#5c6070' }}>
        {cn.exhibitor_name} — against invoice <a href={`/invoices/${cn.invoice_id}`} onClick={(e) => { e.preventDefault(); navigate(`/invoices/${cn.invoice_id}`); }}>{cn.invoice_no}</a> ({fmt(cn.invoice_amount_myr)})
      </p>

      <div style={{ background: '#F5F6FA', borderRadius: 8, padding: 12, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <span>Reason: <strong>{cn.reason_label || '—'}</strong></span>
          <span>Amount: <strong>{fmt(cn.amount_myr)}</strong></span>
        </div>
        {cn.reason && <p style={{ fontSize: 13, marginTop: 6, marginBottom: 0 }}>{cn.reason}</p>}
        <p style={{ fontSize: 12, color: '#5c6070', marginTop: 8, marginBottom: 0 }}>
          Requested by {cn.requested_by_name || '—'} on {new Date(cn.created_at).toLocaleDateString()}
          {cn.approved_by_name && <> · Approved by {cn.approved_by_name} on {cn.approved_at ? new Date(cn.approved_at).toLocaleDateString() : ''}</>}
          {cn.confirmed_by_name && <> · Confirmed by {cn.confirmed_by_name} on {cn.confirmed_at ? new Date(cn.confirmed_at).toLocaleDateString() : ''}</>}
        </p>
        {cn.status === 'REJECTED' && cn.rejection_notes && (
          <p style={{ fontSize: 13, color: '#c83c3c', marginTop: 8, marginBottom: 0 }}>Rejection reason: {cn.rejection_notes}</p>
        )}
      </div>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
        {cn.status === 'PENDING_APPROVAL' && canActOnCn && (
          <>
            <button type="button" disabled={busy} onClick={handleApprove}>Approve</button>
            <button type="button" disabled={busy} onClick={handleReject}>Reject</button>
          </>
        )}
        {canWithdraw && (
          <button type="button" disabled={busy} onClick={() => setShowWithdrawChoice(true)}>Withdraw</button>
        )}
        {cn.status === 'DRAFT' && canConfirm && (
          <button type="button" disabled={busy || attachments.length === 0} onClick={handleConfirm} title={attachments.length === 0 ? 'Upload a supporting document first' : ''}>
            Confirm Credit Note
          </button>
        )}
        {cn.status === 'DRAFT' && !canConfirm && (
          <span style={{ fontSize: 13, color: '#5c6070', alignSelf: 'center' }}>Waiting on Finance to confirm this credit note.</span>
        )}
        {cn.status === 'CONFIRMED' && (
          <button type="button" onClick={() => navigate(`/credit-notes/${cn.id}/print`)}>View / Print Credit Note</button>
        )}
        {cn.status === 'CONFIRMED' && !cn.confirm_acknowledged_at && (
          <button type="button" onClick={handleAcknowledge}>Acknowledge</button>
        )}
        {user?.role_code === 'ADM' && ['DRAFT', 'REJECTED'].includes(cn.status) && (
          <DeleteRecordButton type="creditnote" id={cn.id} label="credit note" onDeleted={() => navigate(`/sales-orders/${cn.sales_order_id}`)} />
        )}
      </div>

      {showWithdrawChoice && (
        <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 24, background: '#FFF8E1' }}>
          <p style={{ marginTop: 0 }}>
            <strong>Withdraw this request?</strong> Choose one now — nothing changes until you do:
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" disabled={busy} onClick={handleEditNow}>Edit Now</button>
            <button type="button" disabled={busy} onClick={handleDeletePermanently} style={{ color: '#c83c3c' }}>Delete Permanently</button>
            <button type="button" disabled={busy} onClick={() => setShowWithdrawChoice(false)}>Cancel — stay pending</button>
          </div>
        </div>
      )}

      <h3>Original Items</h3>
      <BillingTemplate
        parentType="contract"
        parentId={cn.sales_order_id}
        currency="MYR"
        bookingType=""
        items={cn.original_items || []}
        priceList={[]}
        taxCodes={taxCodes}
        lodPct={lodPct}
        showSaveButton={false}
        readOnly
        onSaved={() => {}}
      />

      <h3 style={{ marginTop: 24 }}>Adjusted Items</h3>
      <BillingTemplate
        parentType="contract"
        parentId={cn.sales_order_id}
        currency="MYR"
        bookingType=""
        items={cn.adjusted_items || []}
        priceList={[]}
        taxCodes={taxCodes}
        lodPct={lodPct}
        showSaveButton={false}
        readOnly
        onSaved={() => {}}
      />

      {(cn.status === 'DRAFT' || cn.status === 'CONFIRMED') && (
        <div style={{ marginTop: 32 }}>
          <h3>Attachments</h3>
          <p style={{ fontSize: 13, color: '#5c6070' }}>Upload any related document for audit/reference. Max 3MB per file (compress first if needed).</p>
          <input type="file" onChange={handleUpload} disabled={uploading} />
          <table width="100%" cellPadding="6" style={{ marginTop: 8 }}>
            <tbody>
              {attachments.map((att) => (
                <tr key={att.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td>
                    <a href={api.creditNoteAttachmentDownloadUrl(id, att.id)} target="_blank" rel="noreferrer">{att.original_filename}</a>
                  </td>
                  <td style={{ fontSize: 12, color: '#5c6070' }}>{(att.size_bytes / 1024).toFixed(0)} KB · {att.uploaded_by_name} · {new Date(att.uploaded_at).toLocaleDateString()}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button type="button" onClick={() => handleDeleteAttachment(att)}>Delete</button>
                  </td>
                </tr>
              ))}
              {attachments.length === 0 && <tr><td>No attachments yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
