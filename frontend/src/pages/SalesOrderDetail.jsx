import { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams, useSearchParams, useLocation } from 'react-router-dom';
import { api } from '../api/client';
import { useEventContext } from '../context/EventContext';
import { computeChanges, confirmSave, ChangesBanner, fieldsetStyle } from '../utils/recordForm';
import BillingTemplate from '../components/BillingTemplate';
import { isViewOnly } from '../utils/permissions';

const label = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, marginTop: 12 };
const inputStyle = { display: 'block', width: '100%', padding: 8, boxSizing: 'border-box' };
const fmt = (n, ccy) => `${ccy === 'USD' ? 'USD' : 'RM'} ${Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS_COLORS = {
  DRAFT: { bg: '#F5F6FA', fg: '#5c6070' },
  PENDING_APPROVAL: { bg: '#FFF3BF', fg: '#8a6d1a' },
  APPROVED: { bg: '#E3F6E8', fg: '#1E7B34' },
};

function StatusBadge({ status }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.DRAFT;
  return (
    <span style={{ background: c.bg, color: c.fg, padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600 }}>
      {status.replace('_', ' ')}
    </span>
  );
}

export default function SalesOrderDetail({ user }) {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { events, selectedEventId } = useEventContext();
  const billingRef = useRef(null);
  const pickedBooth = location.state?.pickedBooth;
  const boothAppliedRef = useRef(false);

  const lockedOpportunityId = searchParams.get('opportunity_id') || '';
  const lockedExhibitorId = searchParams.get('exhibitor_id') || '';
  const lockedExhibitorName = searchParams.get('exhibitor_name') || '';
  const lockedEventId = searchParams.get('event_id') || selectedEventId;
  const lockedBoothSqm = searchParams.get('booth_sqm') || '';
  const lockedBoothType = searchParams.get('booth_type') || '';
  const lockedBookingType = searchParams.get('booking_type') || '';
  const lockedCurrency = searchParams.get('currency') || 'MYR';
  const lockedHall = searchParams.get('hall') || '';
  const lockedBoothNo = searchParams.get('booth_no') || '';
  const lockedDimension = searchParams.get('dimension') || '';
  const lockedSalespersonId = searchParams.get('salesperson_id') || '';

  const [form, setForm] = useState({
    exhibitor_id: lockedExhibitorId,
    event_id: lockedEventId,
    opportunity_id: lockedOpportunityId,
    salesperson_id: lockedSalespersonId,
    contract_type: 'STANDARD',
    contract_date: new Date().toISOString().slice(0, 10),
    currency: lockedCurrency,
    booking_type: lockedBookingType,
    hall: lockedHall,
    booth_no: lockedBoothNo,
    dimension: lockedDimension,
    remarks: '',
  });
  const [salesOrder, setSalesOrder] = useState(null); // full record incl. totals/status/exchange_rate
  const [requiredApprover, setRequiredApprover] = useState(null); // { role_code, user_name } | null — from the tiered revenue matrix, null/null means default Admin/Management
  const [canApprove, setCanApprove] = useState(false); // whether the CURRENT user is the one required above
  const [exhibitorName, setExhibitorName] = useState(lockedExhibitorName);
  const [exhibitorSearch, setExhibitorSearch] = useState('');
  const [exhibitorResults, setExhibitorResults] = useState([]);
  const [salespeople, setSalespeople] = useState([]);
  const [stages, setStages] = useState([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [original, setOriginal] = useState(null);
  const [editing, setEditing] = useState(isNew);

  const [items, setItems] = useState([]);
  const [priceList, setPriceList] = useState([]);
  const [taxCodes, setTaxCodes] = useState([]);

  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);

  const [invoices, setInvoices] = useState([]);
  const [showSplitForm, setShowSplitForm] = useState(false);
  const [splitMode, setSplitMode] = useState('FULL'); // FULL | MILESTONE
  const [milestoneSplits, setMilestoneSplits] = useState([{ pct: 50 }, { pct: 50 }]);
  const [generating, setGenerating] = useState(false);

  const [approvalLog, setApprovalLog] = useState([]);
  const [showLog, setShowLog] = useState(false);

  const [creditNotes, setCreditNotes] = useState([]);
  const [showCnForm, setShowCnForm] = useState(false);
  const [cnForm, setCnForm] = useState({ invoice_id: '', amount_myr: '', reason: '' });
  const [cnBusy, setCnBusy] = useState(false);

  function loadItems() {
    if (!id) return;
    api.listSalesOrderItems(id).then(({ items }) => setItems(items));
  }
  function loadAttachments() {
    if (!id) return;
    api.listAttachments(id).then(({ attachments }) => setAttachments(attachments));
  }
  function loadInvoices() {
    if (!id) return;
    api.listInvoices({ sales_order_id: id }).then(({ invoices }) => setInvoices(invoices));
  }
  function loadApprovalLog() {
    if (!id) return;
    api.listApprovalLog(id).then(({ log }) => setApprovalLog(log));
  }
  function loadCreditNotes() {
    if (!id) return;
    api.listCreditNotes({ sales_order_id: id }).then(({ creditNotes }) => setCreditNotes(creditNotes));
  }
  function loadSalesOrder() {
    api.getSalesOrder(id).then(({ salesOrder, requiredApprover, canApprove }) => {
      setRequiredApprover(requiredApprover);
      setCanApprove(canApprove);
      const loaded = {
        exhibitor_id: salesOrder.exhibitor_id,
        event_id: salesOrder.event_id,
        opportunity_id: salesOrder.opportunity_id || '',
        salesperson_id: salesOrder.salesperson_id || '',
        contract_type: salesOrder.contract_type,
        contract_date: salesOrder.contract_date || '',
        currency: salesOrder.currency,
        booking_type: salesOrder.booking_type || '',
        hall: salesOrder.hall || '',
        booth_no: salesOrder.booth_no || '',
        dimension: salesOrder.dimension || '',
        remarks: salesOrder.remarks || '',
      };
      setOriginal(loaded);
      // A picked booth is a pending edit, not yet saved — applied on top of
      // the loaded record so the ChangesBanner correctly shows it as
      // something the user still needs to click Save to persist.
      setForm(pickedBooth ? { ...loaded, hall: pickedBooth.hall, booth_no: pickedBooth.booth_no, dimension: pickedBooth.dimension } : loaded);
      setSalesOrder(salesOrder);
      setExhibitorName(salesOrder.company_name);
      setLoading(false);
    });
  }

  useEffect(() => {
    api.listSalespeople().then(({ salespeople }) => setSalespeople(salespeople));
    api.listTaxCodes().then(({ taxCodes }) => setTaxCodes(taxCodes));
    api.listStages().then(({ stages }) => setStages(stages));
  }, []);

  useEffect(() => {
    if (isNew) return;
    loadSalesOrder();
    loadItems();
    loadAttachments();
    loadInvoices();
    loadApprovalLog();
    loadCreditNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isNew]);

  // Once the Price List has loaded, apply a picked booth's BAS/COR/LOD rows
  // (see the Floor Plan picker below) — needs real price list rates to
  // compute correctly, so this waits rather than firing on mount.
  useEffect(() => {
    if (!pickedBooth || boothAppliedRef.current || priceList.length === 0 || !billingRef.current) return;
    boothAppliedRef.current = true;
    billingRef.current.applyBoothAllocation({ sqm: pickedBooth.sqm, isCorner: pickedBooth.is_corner, isLoading: pickedBooth.is_loading });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceList]);

  useEffect(() => {
    if (!form.event_id) return;
    api.listPriceList(form.event_id).then(({ priceList }) => setPriceList(priceList));
  }, [form.event_id]);

  useEffect(() => {
    if (!exhibitorSearch) {
      setExhibitorResults([]);
      return;
    }
    const t = setTimeout(() => {
      api.listExhibitors(exhibitorSearch).then(({ exhibitors }) => setExhibitorResults(exhibitors));
    }, 250);
    return () => clearTimeout(t);
  }, [exhibitorSearch]);

  // A contract created directly (not transferred from an Opportunity, which
  // already carries its own salesperson forward) defaults to the exhibitor
  // account's assigned salesperson rather than Unassigned.
  useEffect(() => {
    if (!isNew || lockedOpportunityId || !form.exhibitor_id || form.salesperson_id) return;
    api.getExhibitor(form.exhibitor_id).then(({ exhibitor }) => {
      if (exhibitor.salesperson_id) set('salesperson_id', exhibitor.salesperson_id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, lockedOpportunityId, form.exhibitor_id]);

  // EventContext loads asynchronously — a fresh page load can mount this
  // form before selectedEventId resolves, leaving form.event_id (seeded from
  // it) permanently blank since nothing else re-syncs it. Backfill once it
  // arrives, but only if no event_id was explicitly passed via query params.
  useEffect(() => {
    if (isNew && !searchParams.get('event_id') && !form.event_id && selectedEventId) set('event_id', selectedEventId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, selectedEventId]);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function selectExhibitor(ex) {
    set('exhibitor_id', ex.id);
    setExhibitorName(ex.company_name);
    setExhibitorSearch('');
    setExhibitorResults([]);
  }

  const changes = computeChanges(original, form);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!form.exhibitor_id) {
      setError('Please select an exhibitor.');
      return;
    }

    if (!confirmSave(changes, 'contract', isNew)) return;

    // A picked booth (see handlePickFromFloorPlan) only actually locks once
    // this save genuinely succeeds — see the matching note in
    // OpportunityDetail.jsx for why it doesn't lock at pick time.
    const boothPayload = pickedBooth ? { floor_plan_booth_id: pickedBooth.id, exhibitor_name: exhibitorName } : {};

    setSaving(true);
    try {
      if (isNew) {
        const { salesOrder } = await api.createSalesOrder(form);
        navigate(`/sales-orders/${salesOrder.id}`);
      } else {
        await api.updateSalesOrder(id, { ...form, ...boothPayload });
        navigate('/sales-orders');
      }
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  // --- Attachments ---------------------------------------------------------

  async function handleUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      await api.uploadAttachment(id, file);
      loadAttachments();
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
      await api.deleteAttachment(id, att.id);
      loadAttachments();
    } catch (err) {
      setError(err.message);
    }
  }

  // --- Opportunity stage prompts --------------------------------------------
  // A contract's lifecycle drives the linked opportunity's stage rather than
  // the user picking it by hand: printing the approved contract to send to
  // the exhibitor means it's been sent, and issuing the invoice means the
  // deal is won. Both are confirmed with the user, not silent.

  async function promptMoveOpportunityStage(stageCode, message) {
    if (!salesOrder?.opportunity_id) return;
    const targetStage = stages.find((s) => s.code === stageCode);
    if (!targetStage) return;
    const { opportunity } = await api.getOpportunity(salesOrder.opportunity_id);
    if (opportunity.stage_id === targetStage.id) return; // already there
    const current = stages.find((s) => s.id === opportunity.stage_id);
    if (current?.is_won || current?.is_lost) return; // resolved already, don't reopen
    if (window.confirm(message)) {
      await api.updateOpportunity(salesOrder.opportunity_id, { stage_id: targetStage.id });
    }
  }

  // Hands off to the Floor Plan screen's booth picker. Picking here marks
  // the booth SOLD (unlike the Opportunity-side picker, which reserves it)
  // — a contract represents a signed deal, not just a quote.
  function handlePickFromFloorPlan() {
    navigate('/floor-plan', {
      state: {
        pickFor: {
          returnPath: `/sales-orders/${id}`,
          exhibitorName,
          boothStatus: 'SOLD',
          salesOrderId: id,
        },
      },
    });
  }

  async function handleViewPrintContract() {
    if (salesOrder?.status === 'APPROVED') {
      await promptMoveOpportunityStage(
        'STG80',
        "Mark the linked opportunity as 'Contract Sent'? You'll be reminded to upload the signed copy once the exhibitor returns it."
      );
    }
    navigate(`/sales-orders/${id}/print`);
  }

  // --- Invoices --------------------------------------------------------

  async function handleGenerateDraft() {
    setError('');
    const splits = splitMode === 'MILESTONE' ? milestoneSplits : undefined;
    if (splits) {
      const sum = splits.reduce((s, x) => s + Number(x.pct || 0), 0);
      if (sum > 100.01) {
        setError('Milestone percentages add up to more than 100%.');
        return;
      }
    }
    if (!window.confirm(splits ? `Issue ${splits.length} milestone invoices?` : 'Issue an invoice for the full remaining balance?')) return;
    setGenerating(true);
    try {
      await api.generateDraftInvoices({ sales_order_id: id, splits });
      setShowSplitForm(false);
      loadInvoices();
      await promptMoveOpportunityStage('WON', "Mark the linked opportunity as WON?");
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  // --- Approvals ---------------------------------------------------------

  async function handleSubmitForApproval() {
    if (!window.confirm('Send this contract for approval? You can keep editing it while it waits, but Issue Invoice stays locked until Admin/Management approves it.')) return;
    setError('');
    try {
      await api.submitForApproval(id);
      loadSalesOrder();
      loadApprovalLog();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleApprove() {
    if (!window.confirm('Approve this contract?')) return;
    setError('');
    try {
      await api.approveSalesOrder(id);
      loadSalesOrder();
      loadApprovalLog();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleReject() {
    const notes = window.prompt('Reason for rejecting (sent back to Draft):');
    if (notes === null) return;
    setError('');
    try {
      await api.rejectSalesOrder(id, { notes });
      loadSalesOrder();
      loadApprovalLog();
    } catch (err) {
      setError(err.message);
    }
  }

  // --- Credit Notes ------------------------------------------------------
  // Deliberately does NOT touch this contract's own total_myr or any
  // invoice's amount_myr — a Credit Note is a separate, its-own-line AR
  // adjustment (see creditNotes.controller.js) so Reports/revenue figures
  // stay exactly as originally approved. It only ever reduces the specific
  // invoice's outstanding balance, and only once Finance confirms it.
  async function handleRequestCn(e) {
    e.preventDefault();
    if (!window.confirm(`Request a credit note for ${fmt(cnForm.amount_myr, 'MYR')} against this invoice?`)) return;
    setCnBusy(true);
    setError('');
    try {
      await api.requestCreditNote({
        sales_order_id: id,
        invoice_id: cnForm.invoice_id,
        amount_myr: cnForm.amount_myr,
        reason: cnForm.reason,
      });
      setCnForm({ invoice_id: '', amount_myr: '', reason: '' });
      setShowCnForm(false);
      loadCreditNotes();
    } catch (err) {
      setError(err.message);
    } finally {
      setCnBusy(false);
    }
  }

  async function handleApproveCn(cn) {
    if (!window.confirm(`Approve credit note request for ${fmt(cn.amount_myr, 'MYR')} against invoice ${cn.invoice_no}?`)) return;
    setError('');
    try {
      await api.approveCreditNote(cn.id);
      loadCreditNotes();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRejectCn(cn) {
    const notes = window.prompt('Reason for rejecting this credit note request:');
    if (notes === null) return;
    setError('');
    try {
      await api.rejectCreditNote(cn.id, { notes });
      loadCreditNotes();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleConfirmCn(cn) {
    if (!window.confirm(`Confirm credit note ${cn.cn_no}? This is what actually reduces invoice ${cn.invoice_no}'s outstanding balance.`)) return;
    setError('');
    try {
      await api.confirmCreditNote(cn.id);
      loadCreditNotes();
      loadInvoices();
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) return <p style={{ maxWidth: 1100, margin: '40px auto' }}>Loading...</p>;

  const ccy = form.currency;
  const totalInvoiced = invoices.reduce((sum, inv) => sum + Number(inv.amount_foreign), 0);
  const contractTotal = Number(salesOrder?.total_foreign || 0);
  const remaining = contractTotal - totalInvoiced;

  return (
    <div className="page" style={{ maxWidth: 1100, margin: '40px auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {isNew ? 'New Contract' : editing ? 'Edit Contract' : 'Contract'}
          {!isNew && salesOrder && <StatusBadge status={salesOrder.status} />}
        </h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {!isNew && !editing && !isViewOnly(user) && <button type="button" onClick={() => setEditing(true)}>Edit</button>}
          <button type="button" onClick={() => navigate('/sales-orders')}>Back to list</button>
        </div>
      </div>

      {!isNew && salesOrder?.status === 'DRAFT' && (
        <div style={{ background: '#F5F6FA', border: '1px solid #ddd', borderRadius: 8, padding: 12, margin: '12px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>This contract is a draft — send it for approval when it's ready. Invoicing stays locked until Admin/Management approves it.</span>
          <button type="button" onClick={handleSubmitForApproval}>Send for Approval</button>
        </div>
      )}

      {!isNew && salesOrder?.status === 'PENDING_APPROVAL' && canApprove && (
        <div style={{ background: '#FFF3BF', border: '1px solid #F0C36D', borderRadius: 8, padding: 12, margin: '12px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>
            This contract is pending approval
            {requiredApprover?.user_name || requiredApprover?.role_code
              ? ` — requires ${requiredApprover.user_name || `the ${requiredApprover.role_code} role`} (value-based approval tier)`
              : ''}.
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={handleApprove}>Approve</button>
            <button type="button" onClick={handleReject}>Reject</button>
          </div>
        </div>
      )}
      {!isNew && salesOrder?.status === 'PENDING_APPROVAL' && !canApprove && (
        <div style={{ background: '#FFF3BF', border: '1px solid #F0C36D', borderRadius: 8, padding: 12, margin: '12px 0' }}>
          Waiting on approval from {requiredApprover?.user_name || requiredApprover?.role_code
            ? (requiredApprover.user_name || `the ${requiredApprover.role_code} role`)
            : 'Admin/Management'} (this contract's value falls under their approval tier).
        </div>
      )}

      {isNew && lockedOpportunityId && (
        <div style={{ background: '#E3F2FD', border: '1px solid #90CAF9', borderRadius: 8, padding: 12, margin: '12px 0' }}>
          This contract is pre-filled from the opportunity — review the details below, then click <strong>Save</strong> to actually create it. Nothing is saved until you do.
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ maxWidth: 700 }}>
        <fieldset disabled={!editing} style={fieldsetStyle}>
        <label style={label}>Exhibitor *</label>
        {lockedExhibitorId || !isNew ? (
          <div style={{ padding: 8, background: '#F5F6FA', borderRadius: 4 }}>{exhibitorName}</div>
        ) : form.exhibitor_id ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 8, background: '#F5F6FA', borderRadius: 4 }}>
            <span>{exhibitorName}</span>
            <button type="button" onClick={() => { set('exhibitor_id', ''); setExhibitorName(''); }}>Change</button>
          </div>
        ) : (
          <div>
            <input
              style={inputStyle}
              placeholder="Search company name..."
              value={exhibitorSearch}
              onChange={(e) => setExhibitorSearch(e.target.value)}
            />
            {exhibitorResults.length > 0 && (
              <div style={{ border: '1px solid #ddd', borderTop: 'none', maxHeight: 160, overflowY: 'auto' }}>
                {exhibitorResults.map((ex) => (
                  <div
                    key={ex.id}
                    onClick={() => selectExhibitor(ex)}
                    style={{ padding: 8, cursor: 'pointer', borderBottom: '1px solid #eee' }}
                  >
                    {ex.company_name}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {(lockedBoothSqm || lockedBoothType) && (
          <p style={{ fontSize: 13, color: '#5c6070' }}>
            Booth: {lockedBoothType || '—'}, {lockedBoothSqm || '—'} sqm (from linked opportunity)
          </p>
        )}

        <label style={label}>Event (main event)</label>
        <select style={inputStyle} value={form.event_id} onChange={(e) => set('event_id', e.target.value)} disabled={!isNew}>
          {isNew
            ? events.filter((ev) => !ev.parent_event_id).map((ev) => (
                <option key={ev.id} value={ev.id}>{ev.name}</option>
              ))
            // Existing contracts may predate this rule and still sit under a
            // sub-event — keep the full hierarchy available so the read-only
            // view still shows the correct name instead of going blank.
            : events
                .filter((ev) => !ev.parent_event_id)
                .flatMap((main) => [main, ...events.filter((ev) => ev.parent_event_id === main.id)])
                .map((ev) => (
                  <option key={ev.id} value={ev.id}>{ev.parent_event_id ? `— ${ev.name}` : ev.name}</option>
                ))}
        </select>

        <label style={label}>Currency</label>
        <select
          style={inputStyle} value={form.currency} disabled={!isNew && items.length > 0}
          onChange={(e) => { set('currency', e.target.value); billingRef.current?.repriceAll(e.target.value, undefined); }}
        >
          <option value="MYR">MYR</option>
          <option value="USD">USD</option>
        </select>
        {!isNew && salesOrder?.currency === 'USD' && (
          <p style={{ fontSize: 12, color: '#5c6070' }}>
            Estimate rate 1 USD = {Number(salesOrder.exchange_rate).toFixed(4)} MYR (used until invoiced — each invoice then carries Finance's actual rate).
          </p>
        )}

        <label style={label}>Salesperson</label>
        <select style={inputStyle} value={form.salesperson_id} onChange={(e) => set('salesperson_id', e.target.value)}>
          <option value="">— Unassigned —</option>
          {salespeople.map((s) => (
            <option key={s.id} value={s.id}>{s.full_name}</option>
          ))}
        </select>

        <label style={label}>Contract Date</label>
        <input type="date" style={inputStyle} value={form.contract_date} onChange={(e) => set('contract_date', e.target.value)} />

        <label style={label}>Booking Type (rate tier)</label>
        <select
          style={inputStyle} value={form.booking_type}
          onChange={(e) => { set('booking_type', e.target.value); billingRef.current?.repriceAll(undefined, e.target.value); }}
        >
          <option value="">— Select —</option>
          <option value="PUBLISHED RATE">Published Rate</option>
          <option value="EARLY BIRD">Early Bird</option>
          <option value="ONSITE REBOOKING">Onsite Rebooking</option>
          <option value="CONTRA">Contra</option>
        </select>

        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={label}>Hall</label>
            <input style={inputStyle} value={form.hall} onChange={(e) => set('hall', e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={label}>Booth No</label>
            <input style={inputStyle} value={form.booth_no} onChange={(e) => set('booth_no', e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={label}>Dimension</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input style={inputStyle} placeholder="e.g. 3m x 3m" value={form.dimension} onChange={(e) => set('dimension', e.target.value)} />
              {!isNew && (
                <button type="button" onClick={handlePickFromFloorPlan} title="Pick a booth from the Floor Plan" style={{ whiteSpace: 'nowrap' }}>
                  📍 Pick
                </button>
              )}
            </div>
          </div>
        </div>

        <label style={label}>Remarks (any other information for this contract)</label>
        <textarea style={{ ...inputStyle, minHeight: 60 }} value={form.remarks} onChange={(e) => set('remarks', e.target.value)} />
        </fieldset>

        {error && <p style={{ color: 'red' }}>{error}</p>}
        {editing && !isNew && <ChangesBanner changes={changes} />}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          {editing && (
            <button type="submit" disabled={saving} style={{ padding: '8px 16px' }}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          )}
          {!isNew && (
            <>
              <button type="button" onClick={handleViewPrintContract} style={{ padding: '8px 16px' }}>
                View / Print Contract
              </button>
              <button type="button" onClick={() => navigate(`/sales-orders/${id}/proforma`)} style={{ padding: '8px 16px' }}>
                View / Print Proforma
              </button>
            </>
          )}
        </div>
      </form>

      {!isNew && (
        <div style={{ marginTop: 32 }}>
          <h3>Billing</h3>
          <p style={{ fontSize: 13, color: '#5c6070' }}>
            Bare Space is the base item for a booth order — pick one upgrade at most, then add whichever
            services apply. Leave Bare Space unchecked for a non-booth order (badges/sponsorship only).
          </p>
          <BillingTemplate
            ref={billingRef}
            parentType="contract"
            parentId={id}
            currency={ccy}
            bookingType={form.booking_type}
            items={items}
            priceList={priceList}
            taxCodes={taxCodes}
            onSaved={() => { loadItems(); loadSalesOrder(); loadApprovalLog(); }}
          />
          {ccy === 'USD' && (
            <p style={{ textAlign: 'right', fontSize: 13, color: '#5c6070', marginTop: 4 }}>
              ≈ {fmt(salesOrder?.total_myr, 'MYR')} at the estimate rate (saved figure — updates after Save Billing)
            </p>
          )}
        </div>
      )}

      {!isNew && (
        <div style={{ marginTop: 32 }}>
          <h3>Attachments</h3>
          <p style={{ fontSize: 13, color: '#5c6070' }}>Upload the signed contract or any related document for audit/reference.</p>
          <input type="file" onChange={handleUpload} disabled={uploading} />
          <table width="100%" cellPadding="6" style={{ marginTop: 8 }}>
            <tbody>
              {attachments.map((att) => (
                <tr key={att.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td>
                    <a href={api.attachmentDownloadUrl(id, att.id)} target="_blank" rel="noreferrer">{att.original_filename}</a>
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

      {!isNew && (() => {
        const fmtCcy = (n) => fmt(n, ccy);
        return (
          <div style={{ marginTop: 32 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Invoices — {fmtCcy(totalInvoiced)} of {fmtCcy(contractTotal)} invoiced</h3>
              {remaining > 0.01 && contractTotal > 0 && salesOrder?.status === 'APPROVED' && attachments.length > 0 && (
                <button type="button" onClick={() => setShowSplitForm(!showSplitForm)}>
                  {showSplitForm ? 'Cancel' : 'Issue Invoice'}
                </button>
              )}
            </div>
            {remaining > 0.01 && contractTotal > 0 && salesOrder?.status !== 'APPROVED' && (
              <p style={{ fontSize: 13, color: '#5c6070' }}>Invoicing opens once this contract is approved.</p>
            )}
            {remaining > 0.01 && contractTotal > 0 && salesOrder?.status === 'APPROVED' && attachments.length === 0 && (
              <p style={{ fontSize: 13, color: '#5c6070' }}>Upload the signed contract below before you can issue an invoice.</p>
            )}

            {showSplitForm && (
              <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, margin: '12px 0' }}>
                <label style={label}>
                  <input type="radio" checked={splitMode === 'FULL'} onChange={() => setSplitMode('FULL')} /> Single invoice for the remaining balance ({fmtCcy(remaining)})
                </label>
                <label style={label}>
                  <input type="radio" checked={splitMode === 'MILESTONE'} onChange={() => setSplitMode('MILESTONE')} /> Milestone billing (split by %)
                </label>
                {splitMode === 'MILESTONE' && (
                  <div style={{ marginTop: 8 }}>
                    {milestoneSplits.map((s, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                        <input
                          type="number" step="0.01" style={{ ...inputStyle, width: 100 }}
                          value={s.pct}
                          onChange={(e) => {
                            const next = [...milestoneSplits];
                            next[i] = { pct: e.target.value };
                            setMilestoneSplits(next);
                          }}
                        />
                        <span>%</span>
                        <button type="button" onClick={() => setMilestoneSplits(milestoneSplits.filter((_, j) => j !== i))}>Remove</button>
                      </div>
                    ))}
                    <button type="button" onClick={() => setMilestoneSplits([...milestoneSplits, { pct: 0 }])}>+ Add Split</button>
                  </div>
                )}
                <div style={{ marginTop: 16 }}>
                  <button type="button" disabled={generating} onClick={handleGenerateDraft}>
                    {generating ? 'Issuing...' : 'Issue'}
                  </button>
                </div>
              </div>
            )}

            <p style={{ fontSize: 12, color: '#5c6070' }}>
              Drafts are pre-filled at today's estimate rate — Finance reviews each one (date, invoice no., actual exchange rate) and confirms it before it's final.
            </p>
            <table width="100%" cellPadding="6">
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                  <th>Invoice No</th><th>Date</th><th>Status</th><th>Milestone</th><th style={{ textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr
                    key={inv.id}
                    onClick={() => navigate(`/invoices/${inv.id}`)}
                    style={{ borderBottom: '1px solid #eee', cursor: 'pointer' }}
                  >
                    <td>{inv.invoice_no}</td>
                    <td>{inv.invoice_date || '—'}</td>
                    <td>{inv.status === 'DRAFT' ? <span style={{ color: '#8a6d1a' }}>DRAFT</span> : 'Confirmed'}</td>
                    <td>{inv.billing_pct ? `${Number(inv.billing_pct)}%` : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(inv.amount_foreign, inv.currency)}</td>
                  </tr>
                ))}
                {invoices.length === 0 && (
                  <tr><td colSpan={5}>Not invoiced yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        );
      })()}

      {!isNew && salesOrder?.status === 'APPROVED' && (() => {
        const confirmedInvoices = invoices.filter((inv) => inv.status === 'CONFIRMED');
        const canActOnCn = ['ADM', 'MGT', 'FIN'].includes(user?.role_code); // best-effort hint; the backend is the real gate for a tiered-matrix approver who isn't one of these roles
        const CN_STATUS_STYLE = {
          PENDING_APPROVAL: { color: '#8a6d1a', label: 'Pending Approval' },
          DRAFT: { color: '#1B3A6B', label: 'Draft (awaiting Finance)' },
          CONFIRMED: { color: '#1A9C5B', label: 'Confirmed' },
          REJECTED: { color: '#c83c3c', label: 'Rejected' },
        };
        return (
          <div style={{ marginTop: 32 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Value Adjustment (Credit Note)</h3>
              {confirmedInvoices.length > 0 && (
                <button type="button" onClick={() => setShowCnForm(!showCnForm)}>
                  {showCnForm ? 'Cancel' : '+ Request Credit Note'}
                </button>
              )}
            </div>
            <p style={{ fontSize: 12, color: '#5c6070' }}>
              Reduces one confirmed invoice's outstanding balance — this contract's own value and every revenue
              report stay exactly as originally approved. Needs approval (by the tiered matrix in Admin &gt;
              Approval Rules, or Admin/Management by default), then Finance confirms it before it actually takes
              effect.
            </p>
            {confirmedInvoices.length === 0 && (
              <p style={{ fontSize: 13, color: '#5c6070' }}>No confirmed invoice on this contract yet to adjust.</p>
            )}

            {showCnForm && (
              <form onSubmit={handleRequestCn} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 16 }}>
                <label style={label}>Invoice</label>
                <select
                  style={inputStyle} value={cnForm.invoice_id} required
                  onChange={(e) => setCnForm({ ...cnForm, invoice_id: e.target.value })}
                >
                  <option value="">— Select —</option>
                  {confirmedInvoices.map((inv) => (
                    <option key={inv.id} value={inv.id}>{inv.invoice_no} — {fmt(inv.amount_myr, 'MYR')}</option>
                  ))}
                </select>
                <label style={label}>Reduction Amount (RM)</label>
                <input
                  type="number" step="0.01" min="0.01" style={inputStyle} required
                  value={cnForm.amount_myr} onChange={(e) => setCnForm({ ...cnForm, amount_myr: e.target.value })}
                />
                <label style={label}>Reason</label>
                <textarea
                  style={{ ...inputStyle, minHeight: 56 }} required
                  value={cnForm.reason} onChange={(e) => setCnForm({ ...cnForm, reason: e.target.value })}
                />
                <button type="submit" disabled={cnBusy} style={{ marginTop: 12 }}>{cnBusy ? 'Submitting...' : 'Submit Request'}</button>
              </form>
            )}

            {creditNotes.length > 0 && (
              <table width="100%" cellPadding="6">
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                    <th>CN No</th><th>Invoice</th><th>Reason</th><th style={{ textAlign: 'right' }}>Amount</th><th>Status</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {creditNotes.map((cn) => (
                    <tr key={cn.id} style={{ borderBottom: '1px solid #eee' }}>
                      <td>{cn.cn_no || '—'}</td>
                      <td>
                        <a href={`/invoices/${cn.invoice_id}`} onClick={(e) => { e.preventDefault(); navigate(`/invoices/${cn.invoice_id}`); }}>
                          {cn.invoice_no}
                        </a>
                      </td>
                      <td style={{ fontSize: 12, color: '#5c6070' }}>{cn.reason}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(cn.amount_myr, 'MYR')}</td>
                      <td style={{ color: CN_STATUS_STYLE[cn.status]?.color, fontWeight: 600 }}>{CN_STATUS_STYLE[cn.status]?.label || cn.status}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {cn.status === 'PENDING_APPROVAL' && canActOnCn && (
                          <>
                            <button type="button" onClick={() => handleApproveCn(cn)}>Approve</button>{' '}
                            <button type="button" onClick={() => handleRejectCn(cn)}>Reject</button>
                          </>
                        )}
                        {cn.status === 'DRAFT' && user?.role_code === 'FIN' && (
                          <button type="button" onClick={() => handleConfirmCn(cn)}>Confirm</button>
                        )}
                        {cn.status === 'CONFIRMED' && (
                          <button type="button" onClick={() => navigate(`/credit-notes/${cn.id}/print`)}>View</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })()}

      {!isNew && approvalLog.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <button type="button" onClick={() => setShowLog(!showLog)}>{showLog ? 'Hide' : 'Show'} Approval History</button>
          {showLog && (
            <table width="100%" cellPadding="6" style={{ marginTop: 8 }}>
              <tbody>
                {approvalLog.map((l) => (
                  <tr key={l.id} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ fontWeight: 600 }}>{l.action}</td>
                    <td>{l.notes || '—'}</td>
                    <td style={{ fontSize: 12, color: '#5c6070' }}>{l.actor_name || 'System'} · {new Date(l.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
