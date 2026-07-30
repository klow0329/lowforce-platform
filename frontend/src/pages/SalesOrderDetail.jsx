import { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams, useSearchParams, useLocation } from 'react-router-dom';
import { api } from '../api/client';
import { useEventContext } from '../context/EventContext';
import { computeChanges, confirmSave, ChangesBanner, fieldsetStyle } from '../utils/recordForm';
import BillingTemplate, { UPGRADE_CODES, FIXED_LABELS } from '../components/BillingTemplate';
import { isViewOnly } from '../utils/permissions';
import { setUnsavedChanges } from '../utils/unsavedChanges';
import DeleteRecordButton from '../components/DeleteRecordButton';

const label = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, marginTop: 12 };
const inputStyle = { display: 'block', width: '100%', padding: 8, boxSizing: 'border-box' };
const fmt = (n, ccy) => `${ccy === 'USD' ? 'USD' : 'RM'} ${Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const todayStr = new Date().toISOString().slice(0, 10);

const STATUS_COLORS = {
  DRAFT: { bg: '#F5F6FA', fg: '#5c6070' },
  PENDING_APPROVAL: { bg: '#FFF3BF', fg: '#8a6d1a' },
  APPROVED: { bg: '#E3F6E8', fg: '#1E7B34' },
  VOID: { bg: '#FBE3E3', fg: '#B23A3A' },
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
  // Returning from the Floor Plan's booth mass-pickup picker (see
  // handlePickBooths) — nothing is written to the database while picking;
  // the picker just hands back the selected booth set via location.state,
  // and it only actually saves once the user hits Save on THIS form (see
  // handleSubmit). The Floor Plan trip fully unmounts this page (a route
  // change), so any in-progress edits are stashed in sessionStorage first
  // and restored here — same pattern as the CN "adjust booths" flow.
  const pickedBooths = location.state?.pickedBooths;
  const boothAppliedRef = useRef(false);
  const draftKey = `soDraft:${id || 'new'}`;

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
    total_sqm: '',
    credit_terms_id: '',
    remarks: '',
    bill_to_type: 'BILLING',
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
  const [billToPreview, setBillToPreview] = useState({ billingName: '', agentName: '' });

  const [items, setItems] = useState([]);
  const [priceList, setPriceList] = useState([]);
  const [creditTerms, setCreditTerms] = useState([]);
  const [taxCodes, setTaxCodes] = useState([]);
  const [lodPct, setLodPct] = useState(15);

  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);

  const [invoices, setInvoices] = useState([]);
  const [showSplitForm, setShowSplitForm] = useState(false);
  const [splitMode, setSplitMode] = useState('FULL'); // FULL | MILESTONE
  const [milestoneSplits, setMilestoneSplits] = useState([{ pct: 50, expected_billing_date: '' }, { pct: 50, expected_billing_date: '' }]);
  const [generating, setGenerating] = useState(false);

  const [approvalLog, setApprovalLog] = useState([]);
  const [showLog, setShowLog] = useState(false);

  const [creditNotes, setCreditNotes] = useState([]);
  const [reasonCodes, setReasonCodes] = useState([]);

  // --- Contract Reduction (item-based, same billing-adjustment UX the old
  // standalone Credit Note request flow used — see contractReductions.
  // controller.js. Sales edits the real line items/releases booths; the
  // system derives new_total_foreign and any Credit Note shortfall itself.
  // A CN, if one's needed, is approved together with the reduction but only
  // actually issued afterward — see handleIssueReductionCn below.) --------
  const [contractReductions, setContractReductions] = useState([]);
  const [showReductionForm, setShowReductionForm] = useState(false);
  const [reductionEditingId, setReductionEditingId] = useState(null);
  const [reductionReasonCodeId, setReductionReasonCodeId] = useState('');
  const [reductionNotes, setReductionNotes] = useState('');
  const [reductionBookingType, setReductionBookingType] = useState('');
  const [reductionAdjustedTotal, setReductionAdjustedTotal] = useState(null);
  const [reductionAdjustedBasQty, setReductionAdjustedBasQty] = useState(null);
  const [reductionReleasedBoothIds, setReductionReleasedBoothIds] = useState([]);
  const [reductionDraftItems, setReductionDraftItems] = useState(null);
  const [reductionBusy, setReductionBusy] = useState(false);
  const [issueCnForId, setIssueCnForId] = useState(null); // which reduction's "Issue Credit Note" picker is open
  const [issueCnInvoiceId, setIssueCnInvoiceId] = useState('');
  const reductionBillingRef = useRef(null);
  // Re-splitting whatever's still SCHEDULED (not yet issued) after a
  // reduction — invoiceId -> { mode: 'amount'|'pct', value: string }, same
  // %/amount two-way pattern as a billing row's discount field.
  const [milestoneEdits, setMilestoneEdits] = useState({});
  const [milestoneBusy, setMilestoneBusy] = useState(false);
  function loadContractReductions() {
    if (!id) return;
    api.listContractReductions(id).then(({ contractReductions }) => setContractReductions(contractReductions));
  }

  // null = not loaded yet — kept distinct from [] (genuinely zero booths) so
  // the sync-to-form effect below never overwrites hall/booth_no with a
  // premature blank before the real set has actually arrived. This is now
  // the STAGED set (may not match the database until Save) rather than a
  // live server mirror — see handleSubmit for where it actually commits.
  const [linkedBooths, setLinkedBooths] = useState(null);
  // Overrides the normal server-loaded `items` when restoring a draft after
  // a Floor Plan round trip — BillingTemplate reseeds its rows from
  // whichever of these two is passed as its `items` prop.
  const [draftBillingItems, setDraftBillingItems] = useState(null);
  function loadLinkedBooths() {
    if (!id) return;
    api.listSalesOrderBooths(id).then(({ booths }) => setLinkedBooths(booths));
  }

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
    return api.getSalesOrder(id).then(({ salesOrder, requiredApprover, canApprove }) => {
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
        total_sqm: salesOrder.total_sqm ?? '',
        credit_terms_id: salesOrder.credit_terms_id || '',
        remarks: salesOrder.remarks || '',
        bill_to_type: salesOrder.bill_to_type || 'BILLING',
      };
      setOriginal(loaded);
      setForm(loaded);
      setBillToPreview({ billingName: salesOrder.billing_name || '', agentName: salesOrder.agent_name || '' });
      setSalesOrder(salesOrder);
      setExhibitorName(salesOrder.company_name);
      setLoading(false);
    });
  }

  useEffect(() => {
    api.listSalespeople().then(({ salespeople }) => setSalespeople(salespeople));
    api.listTaxCodes().then(({ taxCodes }) => setTaxCodes(taxCodes));
    api.listStages().then(({ stages }) => setStages(stages));
    api.listCnReasonCodes().then(({ reasonCodes }) => setReasonCodes(reasonCodes));
    api.getSettings().then(({ settings }) => setLodPct(settings?.lod_pct_of_bas ?? 15));
  }, []);

  // Loads the record fresh — UNLESS a draft was stashed in sessionStorage
  // right before a Floor Plan trip (see handlePickBooths), in which case
  // that draft wins for the form/booths/billing: it's strictly more recent
  // than whatever's on the server, since it holds edits the user hadn't
  // saved yet when they left for the picker.
  useEffect(() => {
    const draftRaw = sessionStorage.getItem(draftKey);
    const draft = draftRaw ? JSON.parse(draftRaw) : null;

    function applyDraft() {
      setForm(draft.form);
      setExhibitorName(draft.exhibitorName);
      setLinkedBooths(pickedBooths || draft.linkedBooths || []);
      setDraftBillingItems(draft.billingItems);
      sessionStorage.removeItem(draftKey);
    }

    if (isNew) {
      if (draft) applyDraft();
      else setLinkedBooths([]);
      return;
    }

    // loadSalesOrder() sets `original`/`form` from the server — when a draft
    // exists, its own setForm must win, so applyDraft is chained onto the
    // SAME promise instead of firing independently (it would otherwise be a
    // race, since both are async and either could resolve last).
    const salesOrderPromise = loadSalesOrder();
    loadAttachments();
    loadInvoices();
    loadApprovalLog();
    loadCreditNotes();
    loadContractReductions();
    if (draft) {
      salesOrderPromise.then(applyDraft);
    } else {
      loadItems();
      loadLinkedBooths();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isNew]);

  // Hall/Booth No/Total Sqm are all derived, read-only displays of whatever's
  // currently linked on the Floor Plan (see handlePickBooths) — Hall shows
  // the single hall name, or "Multi" once booths span more than one; Booth No
  // lists every individual booth number; Total Sqm is the sum of every
  // linked booth's sqm. Per the sales team's rule, booth allocation now
  // drives these fields — there is no more free-text entry for any of them,
  // so if a selection looks wrong the fix is to re-open the Floor Plan
  // picker, not to type a correction here. Kept in `form` (not just shown
  // separately) so Save still persists the current text/number into those
  // columns for the print pages that read them directly.
  useEffect(() => {
    if (linkedBooths === null) return;
    const hallNames = [...new Set(linkedBooths.map((b) => b.hall_name).filter(Boolean))];
    const hall = hallNames.length === 0 ? '' : (hallNames.length === 1 ? hallNames[0] : 'Multi');
    const boothNo = linkedBooths.map((b) => b.booth_no).join(', ');
    const totalSqm = linkedBooths.reduce((sum, b) => sum + (Number(b.sqm) || 0), 0);
    setForm((f) => (f.hall === hall && f.booth_no === boothNo && Number(f.total_sqm) === totalSqm
      ? f : { ...f, hall, booth_no: boothNo, total_sqm: totalSqm }));
  }, [linkedBooths]);

  // Once linkedBooths and the Price List have both loaded AND we've just
  // returned from a booth pick (pickedBooths), apply the aggregate BAS/COR/
  // LOD rows from the full picked set — sum of every linked booth's sqm,
  // corner/loading flagged if ANY linked booth is. Guarded to run once per
  // return trip so it never overwrites a manual billing edit on a plain
  // page reload.
  useEffect(() => {
    if (!pickedBooths || boothAppliedRef.current || linkedBooths === null || priceList.length === 0 || !billingRef.current) return;
    boothAppliedRef.current = true;
    // Sum sqm per tagged type (untagged booths count as Bare Space — see
    // FloorPlan.jsx's per-booth type tagging in the cap-mode picker).
    const byType = {};
    for (const b of linkedBooths) {
      const code = b.allocated_item_code || 'BAS';
      byType[code] = (byType[code] || 0) + (Number(b.sqm) || 0);
    }
    const isCorner = linkedBooths.some((b) => b.is_corner);
    const isLoading = linkedBooths.some((b) => b.is_loading);
    billingRef.current.applyBoothAllocation({ byType, isCorner, isLoading });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedBooths, priceList, pickedBooths]);

  useEffect(() => {
    if (!form.event_id) return;
    api.listPriceList(form.event_id).then(({ priceList }) => setPriceList(priceList));
    api.listCreditTerms(form.event_id).then(({ creditTerms }) => setCreditTerms(creditTerms));
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
  // account's assigned salesperson rather than Unassigned — and RE-derives
  // it every time the exhibitor changes (not just once when blank), so
  // switching from Company A to Company B while still drafting carries over
  // B's own rep instead of leaving A's behind. Keyed only on exhibitor_id
  // changing, so a manual salesperson pick for the SAME exhibitor sticks.
  useEffect(() => {
    if (!isNew || lockedOpportunityId || !form.exhibitor_id) return;
    api.getExhibitor(form.exhibitor_id).then(({ exhibitor }) => {
      set('salesperson_id', exhibitor.salesperson_id || '');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, lockedOpportunityId, form.exhibitor_id]);

  // Bill To preview — which real name each option would resolve to.
  useEffect(() => {
    if (!isNew || !form.exhibitor_id) return;
    api.getExhibitor(form.exhibitor_id).then(({ exhibitor }) => {
      setBillToPreview({ billingName: exhibitor.billing_name || '', agentName: exhibitor.agent_name || '' });
    });
  }, [isNew, form.exhibitor_id]);

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

  // Warns before the user navigates away (nav bar links, tab close/refresh)
  // with unsaved edits — cleared on unmount so it never leaks onto the next
  // page after a confirmed discard or a successful Save. Also covers an
  // in-progress Contract Reduction request, which lives in its own separate
  // state (reductionReasonCodeId etc.) rather than the main contract `form`.
  const reductionFormDirty = showReductionForm && Boolean(reductionReasonCodeId || reductionNotes);
  useEffect(() => {
    const isDirty = (editing && (isNew ? Boolean(exhibitorName) : changes.length > 0)) || reductionFormDirty;
    setUnsavedChanges(isDirty, 'You have unsaved contract changes that will be lost if you leave. Continue?');
    return () => setUnsavedChanges(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, isNew, changes.length, exhibitorName, reductionFormDirty]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!form.exhibitor_id) {
      setError('Please select an exhibitor.');
      return;
    }

    if (!confirmSave(changes, 'contract', isNew)) return;

    setSaving(true);
    try {
      // Booths picked on the Floor Plan are staged locally only (see
      // handlePickBooths) — nothing is written to the database until here,
      // as part of this same Save, so leaving the form without saving never
      // touches the booth's real record.
      const boothIds = (linkedBooths || []).map((b) => b.id);
      const boothItemCodes = Object.fromEntries((linkedBooths || []).map((b) => [b.id, b.allocated_item_code || null]));
      if (isNew) {
        const { salesOrder } = await api.createSalesOrder(form);
        await api.bulkSetSalesOrderBooths(salesOrder.id, { floor_plan_booth_ids: boothIds, booth_item_codes: boothItemCodes, exhibitor_name: exhibitorName });
        navigate(`/sales-orders/${salesOrder.id}`);
      } else {
        await api.updateSalesOrder(id, form);
        await api.bulkSetSalesOrderBooths(id, { floor_plan_booth_ids: boothIds, booth_item_codes: boothItemCodes, exhibitor_name: exhibitorName });
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
    if (file.size > 5 * 1024 * 1024) {
      setError('File is too large — the limit is 5MB. Please compress it and try again.');
      e.target.value = '';
      return;
    }
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

  // Hands off to the Floor Plan's mass-pickup picker (see FloorPlan.jsx's
  // 'cap' pickFor mode) — the picker only stages a selection and hands it
  // back via location.state; nothing is written to the database until the
  // user actually hits Save on this form (see handleSubmit). Works the same
  // way whether this is a brand-new, never-saved contract or an existing
  // one — no record needs to exist yet just to try out a booth pick. The
  // Floor Plan trip fully remounts this page, so the in-progress form (and
  // any not-yet-saved billing rows) is stashed in sessionStorage first and
  // restored on the way back.
  function handlePickBooths() {
    setError('');
    if (!form.exhibitor_id) {
      setError('Please select an exhibitor before picking booths.');
      return;
    }
    const snapshot = billingRef.current?.getSnapshot();
    sessionStorage.setItem(draftKey, JSON.stringify({
      form, exhibitorName, linkedBooths: linkedBooths || [],
      billingItems: snapshot ? snapshot.items : null,
    }));
    // Which booth-item codes the current billing already expects — lets the
    // picker auto-resolve the common single-type case silently, and only
    // surface per-booth tagging when the contract genuinely mixes types (see
    // FloorPlan.jsx's capIsMixed).
    const upgradeCodes = [...UPGRADE_CODES];
    for (const p of priceList) if (p.is_upgrade_option && !upgradeCodes.includes(p.sales_item_code)) upgradeCodes.push(p.sales_item_code);
    const upgradeOptions = upgradeCodes.map((code) => ({
      code, label: priceList.find((p) => p.sales_item_code === code)?.description || FIXED_LABELS[code] || code,
    }));
    const itemTypeTotals = {};
    for (const it of (snapshot?.items || [])) {
      if (it.sales_item_code === 'BAS' || upgradeCodes.includes(it.sales_item_code)) {
        itemTypeTotals[it.sales_item_code] = (itemTypeTotals[it.sales_item_code] || 0) + Number(it.qty || 0);
      }
    }
    navigate('/floor-plan', {
      state: {
        pickFor: {
          mode: 'cap',
          recordType: 'contract',
          recordId: isNew ? null : id,
          returnPath: isNew ? '/sales-orders/new' : `/sales-orders/${id}`,
          exhibitorName,
          preSelectedBooths: linkedBooths || [],
          cap: null,
          upgradeOptions,
          itemTypeTotals,
        },
      },
    });
  }

  // Lets Sales relocate an APPROVED contract's booth(s) — e.g. the exhibitor
  // needs to move to a different spot — without the normal Edit/Save gate,
  // which stays locked once approved (see isLocked below). Reuses the same
  // Floor Plan cap-mode picker as handlePickBooths; the new selection is
  // only staged locally (in pickedBooths/linkedBooths) until the user
  // confirms via handleSaveBoothChange, same nothing-written-until-saved
  // rule as everywhere else booths are picked.
  async function handleSaveBoothChange() {
    if (!window.confirm('Save this booth change? Floor Plan allocation and billing (Bare Space/Corner/Loading) will be updated to match the new booth selection.')) return;
    setError('');
    setSaving(true);
    try {
      const boothIds = (linkedBooths || []).map((b) => b.id);
      const boothItemCodes = Object.fromEntries((linkedBooths || []).map((b) => [b.id, b.allocated_item_code || null]));
      await api.bulkSetSalesOrderBooths(id, { floor_plan_booth_ids: boothIds, booth_item_codes: boothItemCodes, exhibitor_name: exhibitorName });
      const boothNos = (linkedBooths || []).map((b) => b.booth_no).join(', ') || '(none)';
      await billingRef.current?.save(id, `Booth change — now ${boothNos}.`);
      boothAppliedRef.current = false;
      navigate(`/sales-orders/${id}`, { replace: true, state: {} });
      loadSalesOrder();
      loadItems();
      loadLinkedBooths();
      loadApprovalLog();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function handleDiscardBoothChange() {
    boothAppliedRef.current = false;
    navigate(`/sales-orders/${id}`, { replace: true, state: {} });
    loadLinkedBooths();
  }

  // The pre-signature "View Proposal" document now lives on the Opportunity
  // page (see OpportunityDetail.jsx) — a Contract only ever exists once
  // there's a signed deal, so the only document this page shows is the
  // Contract itself. The Contract-Sent stage prompt still only fires once
  // the contract is truly APPROVED — viewing it earlier is just a preview,
  // nothing to mark sent.
  async function handleViewContract() {
    if (salesOrder?.status === 'APPROVED') {
      await promptMoveOpportunityStage(
        'STG80',
        "Mark the linked opportunity as 'Contract Sent'? You'll be reminded to upload the signed copy once the exhibitor returns it."
      );
    }
    navigate(`/sales-orders/${id}/print`);
  }

  // Void is the undo path for a contract that hasn't been invoiced yet — the
  // backend itself also blocks this once any invoice exists (see
  // approvals.controller.js's voidSalesOrder), so canVoid below is just the
  // UI-side mirror of that same rule.
  async function handleVoid() {
    const reason = window.prompt("Reason for voiding this contract (shown in its history) — leave blank if there isn't one:");
    if (reason === null) return;
    if (!window.confirm('Void this contract? The linked opportunity (if any) will be marked Lost and its booth allocation released. This cannot be undone from here.')) return;
    setError('');
    try {
      await api.voidSalesOrder(id, { reason });
      loadSalesOrder();
      loadApprovalLog();
    } catch (err) {
      setError(err.message);
    }
  }

  // --- Invoices --------------------------------------------------------

  async function handleGenerateDraft() {
    setError('');
    const splits = splitMode === 'MILESTONE' ? milestoneSplits : undefined;
    if (splits) {
      const sum = splits.reduce((s, x) => s + Number(x.pct || 0), 0);
      if (Math.abs(sum - 100) > 0.01) {
        window.alert(`Milestone percentages must add up to exactly 100% — currently ${sum.toFixed(2)}%.`);
        return;
      }
    }
    const scheduledCount = splits ? splits.filter((s) => s.expected_billing_date && s.expected_billing_date > todayStr).length : 0;
    const issueNowCount = splits ? splits.length - scheduledCount : 1;
    const confirmMsg = splits
      ? `Issue ${issueNowCount} invoice(s) now${scheduledCount > 0 ? ` and schedule ${scheduledCount} for later` : ''}?`
      : 'Issue an invoice for the full remaining balance?';
    if (!window.confirm(confirmMsg)) return;
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

  async function handleIssueScheduled(inv) {
    if (!window.confirm(`Issue this ${inv.billing_pct ? `${Number(inv.billing_pct)}% ` : ''}milestone invoice now?`)) return;
    setError('');
    try {
      await api.issueScheduledInvoice(inv.id);
      loadInvoices();
    } catch (err) {
      setError(err.message);
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

  // Self-service pull-back — no approver gate on the backend either (see
  // approvals.controller.js's withdrawApproval), since this only ever moves
  // the contract back to Draft, the same place a Reject would land it.
  async function handleWithdrawApproval() {
    if (!window.confirm('Withdraw this contract from approval and send it back to Draft?')) return;
    setError('');
    try {
      await api.withdrawApproval(id);
      loadSalesOrder();
      loadApprovalLog();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleWithdrawInvoice(inv) {
    const label = inv.status === 'SCHEDULED' ? 'this scheduled milestone' : `draft invoice ${inv.invoice_no}`;
    if (!window.confirm(`Withdraw ${label}? It will be deleted and this contract's remaining balance opens back up for invoicing.`)) return;
    setError('');
    try {
      await api.withdrawInvoice(inv.id);
      loadInvoices();
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

  // --- Contract Reduction --------------------------------------------------
  // Requested the same way the old standalone Credit Note flow worked —
  // Sales edits the real line items (in a scratch, never-saved
  // BillingTemplate instance below) and releases any excess booths, rather
  // than typing a bare target total. new_total_foreign and any resulting
  // Credit Note shortfall are derived server-side from those items. Does
  // NOT touch this contract's own total_myr or any invoice's amount_myr
  // until APPROVED (see contractReductions.controller.js) — nothing is
  // final while still pending.
  function openReductionForm() {
    sessionStorage.removeItem(`reductionDraft:${id}`);
    setReductionEditingId(null);
    setReductionReasonCodeId('');
    setReductionNotes('');
    setReductionBookingType(form.booking_type || '');
    setReductionAdjustedTotal(null);
    setReductionAdjustedBasQty(null);
    setReductionReleasedBoothIds([]);
    setReductionDraftItems(null);
    setShowReductionForm(true);
  }

  // Reopens a still-pending request for editing.
  function openReductionFormForEdit(cr) {
    sessionStorage.removeItem(`reductionDraft:${id}`);
    setReductionEditingId(cr.id);
    setReductionReasonCodeId(cr.reason_code_id);
    setReductionNotes(cr.notes || '');
    setReductionBookingType(form.booking_type || '');
    setReductionAdjustedTotal(null);
    setReductionAdjustedBasQty(null);
    setReductionReleasedBoothIds(cr.released_booth_ids || []);
    setReductionDraftItems(cr.reduced_items || null);
    setShowReductionForm(true);
  }

  // Sends the user to the Floor Plan to release specific booths down to the
  // reduction's adjusted Bare Space qty — nothing is saved to the contract
  // from there (see FloorPlan.jsx's 'cn' pick mode, reused as-is here since
  // the "stage a release, only committed on approval" behavior is
  // identical), it just hands the still-selected set back. The in-progress
  // scratch edits would otherwise be lost on the round trip since this page
  // fully remounts on navigation — stashed in sessionStorage and restored
  // below.
  function handleAdjustReductionBooths() {
    const snapshot = reductionBillingRef.current?.getSnapshot();
    sessionStorage.setItem(`reductionDraft:${id}`, JSON.stringify({
      reductionReasonCodeId, reductionNotes, reductionBookingType,
      items: snapshot ? snapshot.items : items,
    }));
    navigate('/floor-plan', {
      state: {
        pickFor: {
          mode: 'cn', recordType: 'contract', recordId: id, exhibitorName,
          cap: reductionAdjustedBasQty, returnPath: `/sales-orders/${id}`,
        },
      },
    });
  }

  const reductionRestoreAppliedRef = useRef(false);
  useEffect(() => {
    if (!location.state?.cnBoothsPicked || reductionRestoreAppliedRef.current || linkedBooths === null) return;
    reductionRestoreAppliedRef.current = true;
    const draftRaw = sessionStorage.getItem(`reductionDraft:${id}`);
    if (!draftRaw) return;
    const draft = JSON.parse(draftRaw);
    setReductionReasonCodeId(draft.reductionReasonCodeId);
    setReductionNotes(draft.reductionNotes);
    setReductionBookingType(draft.reductionBookingType);
    setReductionDraftItems(draft.items);
    const selectedIds = new Set(location.state.cnSelectedBoothIds || []);
    setReductionReleasedBoothIds(linkedBooths.filter((b) => !selectedIds.has(b.id)).map((b) => b.id));
    setShowReductionForm(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, linkedBooths]);

  const reductionLinkedAllocatedSqm = (linkedBooths || []).reduce((sum, b) => sum + (Number(b.sqm) || 0), 0);
  const reductionReleasedSqm = (linkedBooths || [])
    .filter((b) => reductionReleasedBoothIds.includes(b.id))
    .reduce((sum, b) => sum + (Number(b.sqm) || 0), 0);
  const reductionRemainingAllocatedSqm = reductionLinkedAllocatedSqm - reductionReleasedSqm;
  const reductionNeedsBoothRelease = reductionAdjustedBasQty !== null && reductionRemainingAllocatedSqm > reductionAdjustedBasQty + 0.01;

  async function handleRequestReduction() {
    if (!reductionReasonCodeId) { setError('Select a reason.'); return; }
    const snapshot = reductionBillingRef.current?.getSnapshot();
    if (!snapshot) return;
    if (!(snapshot.total < contractTotal - 0.01)) {
      setError('No reduction detected yet — reduce a quantity/rate or remove a row in the adjusted items below.');
      return;
    }
    if (reductionNeedsBoothRelease) {
      setError(`Booth allocation (${reductionRemainingAllocatedSqm} sqm) still exceeds the adjusted Bare Space qty (${reductionAdjustedBasQty} sqm) — release booths on the Floor Plan first.`);
      return;
    }
    if (!window.confirm(`Request reducing this contract from ${fmt(contractTotal, ccy)} to ${fmt(snapshot.total, ccy)}?`)) return;
    setReductionBusy(true);
    setError('');
    try {
      const payload = {
        reason_code_id: reductionReasonCodeId,
        notes: reductionNotes,
        items: snapshot.items,
        released_booth_ids: reductionReleasedBoothIds,
      };
      if (reductionEditingId) await api.updateContractReduction(reductionEditingId, payload);
      else await api.requestContractReduction({ sales_order_id: id, ...payload });
      sessionStorage.removeItem(`reductionDraft:${id}`);
      setShowReductionForm(false);
      setReductionEditingId(null);
      loadContractReductions();
    } catch (err) {
      setError(err.message);
    } finally {
      setReductionBusy(false);
    }
  }

  async function handleApproveReduction(crId) {
    if (!window.confirm('Approve this contract reduction? This updates the contract\'s items/total and releases any staged booths immediately. If a credit note is needed, it becomes ready to issue afterward — it is not created yet.')) return;
    setReductionBusy(true);
    setError('');
    try {
      await api.approveContractReduction(crId);
      loadContractReductions();
      loadSalesOrder();
      loadItems();
      loadInvoices();
      loadLinkedBooths();
      loadCreditNotes();
      loadApprovalLog();
    } catch (err) {
      setError(err.message);
    } finally {
      setReductionBusy(false);
    }
  }

  async function handleRejectReduction(crId) {
    const notes = window.prompt('Reason for rejecting this reduction request (optional):');
    if (notes === null) return;
    setReductionBusy(true);
    setError('');
    try {
      await api.rejectContractReduction(crId, { notes });
      loadContractReductions();
    } catch (err) {
      setError(err.message);
    } finally {
      setReductionBusy(false);
    }
  }

  async function handleWithdrawReduction(crId) {
    if (!window.confirm('Withdraw this reduction request?')) return;
    setReductionBusy(true);
    setError('');
    try {
      await api.deleteContractReduction(crId);
      loadContractReductions();
    } catch (err) {
      setError(err.message);
    } finally {
      setReductionBusy(false);
    }
  }

  // Sales issues the pre-approved shortfall as a real Credit Note, against
  // whichever confirmed invoice they pick now — the amount was already
  // fixed and approved as part of the reduction itself, so this never asks
  // for a fresh approval.
  async function handleIssueReductionCn(crId) {
    if (!issueCnInvoiceId) { setError('Select which invoice this credit note applies against.'); return; }
    if (!window.confirm('Issue this credit note? Finance still needs to Confirm it (with an attachment) before it affects the invoice balance.')) return;
    setReductionBusy(true);
    setError('');
    try {
      await api.issueContractReductionCn(crId, { invoice_id: issueCnInvoiceId });
      setIssueCnForId(null);
      setIssueCnInvoiceId('');
      loadContractReductions();
      loadCreditNotes();
    } catch (err) {
      setError(err.message);
    } finally {
      setReductionBusy(false);
    }
  }

  // Whatever's left to bill after a reduction (contract total minus already
  // CONFIRMED invoices) has to be re-split across the still-SCHEDULED
  // milestones — Sales' own call, not something the system guesses at.
  // Saves every edited row in one go, only once the edited amounts add up
  // exactly to that leftover balance.
  async function handleSaveMilestoneRebalance() {
    const leftover = Math.max(0, contractTotal - confirmedInvoices.reduce((s, inv) => s + Number(inv.amount_foreign), 0));
    const edited = scheduledInvoices.filter((inv) => milestoneEdits[inv.id]);
    const total = scheduledInvoices.reduce((s, inv) => {
      const edit = milestoneEdits[inv.id];
      return s + (edit ? Number(edit.amount) || 0 : Number(inv.amount_foreign));
    }, 0);
    if (Math.abs(total - leftover) > 0.01) {
      setError(`The milestone amounts must add up to the remaining balance (${fmt(leftover, ccy)}) — currently ${fmt(total, ccy)}.`);
      return;
    }
    if (edited.length === 0) return;
    if (!window.confirm('Save these milestone amounts?')) return;
    setMilestoneBusy(true);
    setError('');
    try {
      for (const inv of edited) {
        await api.updateInvoice(inv.id, { amount_foreign: Number(milestoneEdits[inv.id].amount) || 0 });
      }
      setMilestoneEdits({});
      loadInvoices();
    } catch (err) {
      setError(err.message);
    } finally {
      setMilestoneBusy(false);
    }
  }

  if (loading) return <p style={{ maxWidth: 1100, margin: '40px auto' }}>Loading...</p>;

  const ccy = form.currency;
  // "Invoiced" (the header figure) counts only real issued documents — a
  // SCHEDULED milestone isn't one yet. "Committed" also counts SCHEDULED,
  // since that portion is already earmarked and must not be split again.
  const totalInvoiced = invoices.filter((inv) => inv.status !== 'SCHEDULED').reduce((sum, inv) => sum + Number(inv.amount_foreign), 0);
  const totalCommitted = invoices.reduce((sum, inv) => sum + Number(inv.amount_foreign), 0);
  const contractTotal = Number(salesOrder?.total_foreign || 0);
  const remaining = contractTotal - totalCommitted;
  const confirmedInvoices = invoices.filter((inv) => inv.status === 'CONFIRMED');
  const scheduledInvoices = invoices.filter((inv) => inv.status === 'SCHEDULED');
  // Locked once submitted for approval — nobody edits a contract that's
  // sitting in someone's approval queue, including the approver themselves
  // (their job is Approve/Reject/Withdraw, never edit). Stays locked once
  // approved, to everyone but Finance/Admin/Management-gated Void
  // (pre-invoice) or Credit Note (post-invoice) — see
  // approvals.controller.js's voidSalesOrder for the matching backend rule.
  const isLocked = ['PENDING_APPROVAL', 'APPROVED', 'VOID'].includes(salesOrder?.status);
  const canVoid = !isNew && !isViewOnly(user) && salesOrder
    && ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'].includes(salesOrder.status) && invoices.length === 0;
  const canRequestCn = salesOrder?.status === 'APPROVED' && confirmedInvoices.length > 0;
  const canRequestReduction = salesOrder?.status === 'APPROVED' && !isViewOnly(user);

  return (
    <div className="page" style={{ maxWidth: 1100, margin: '40px auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {isNew ? 'New Contract' : editing ? 'Edit Contract' : 'Contract'}
          {!isNew && salesOrder && <StatusBadge status={salesOrder.status} />}
        </h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {!isNew && !editing && !isViewOnly(user) && !isLocked && <button type="button" onClick={() => setEditing(true)}>Edit</button>}
          <button type="button" onClick={() => navigate('/sales-orders')}>Back to list</button>
        </div>
      </div>
      {error && <p style={{ color: 'red', fontWeight: 600 }}>{error}</p>}

      {!isNew && salesOrder?.status === 'VOID' && (
        <div style={{ background: '#FBE3E3', border: '1px solid #E3A8A8', borderRadius: 8, padding: 12, margin: '12px 0' }}>
          This contract was voided{salesOrder.void_reason ? ` — ${salesOrder.void_reason}` : ''}. No further action is available on it.
        </div>
      )}
      {!isNew && salesOrder?.needs_booth_reallocation && (
        <div style={{ background: '#FBE3E3', border: '1px solid #E5A0A0', borderRadius: 8, padding: 12, margin: '12px 0' }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#8a1f1f' }}>
            A booth this contract was proposing went to another contract that got approved first — please pick a
            replacement booth on the Floor Plan as soon as possible.
          </p>
          <button type="button" onClick={handlePickBooths} style={{ marginTop: 8 }}>Pick Booths on Floor Plan</button>
        </div>
      )}

      {!isNew && (salesOrder?.status === 'APPROVED' || salesOrder?.needs_booth_reallocation) && pickedBooths && (
        <div style={{ background: '#E3F2FD', border: '1px solid #90CAF9', borderRadius: 8, padding: 12, margin: '12px 0' }}>
          <p style={{ margin: 0, fontSize: 13 }}>
            New booth selection: <strong>{(linkedBooths || []).map((b) => b.booth_no).join(', ') || '(none)'}</strong>{' '}
            ({(linkedBooths || []).reduce((s, b) => s + (Number(b.sqm) || 0), 0)} sqm). Nothing is saved yet.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" onClick={handleSaveBoothChange} disabled={saving}>{saving ? 'Saving...' : 'Save Booth Change'}</button>
            <button type="button" onClick={handleDiscardBoothChange} disabled={saving}>Discard</button>
            {/* Right at eye level next to Save, not buried up top — a
                validation failure (e.g. upgrade sqm over Bare Space) is
                impossible to miss here. */}
            {error && (
              <span style={{ color: '#B23A3A', fontSize: 13, fontWeight: 600, background: '#FBE3E3', padding: '4px 10px', borderRadius: 6 }}>
                {error}
              </span>
            )}
          </div>
        </div>
      )}

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
            {!isViewOnly(user) && <button type="button" onClick={handleWithdrawApproval}>Withdraw</button>}
          </div>
        </div>
      )}
      {!isNew && salesOrder?.status === 'PENDING_APPROVAL' && !canApprove && (
        <div style={{ background: '#FFF3BF', border: '1px solid #F0C36D', borderRadius: 8, padding: 12, margin: '12px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>
            Waiting on approval from {requiredApprover?.user_name || requiredApprover?.role_code
              ? (requiredApprover.user_name || `the ${requiredApprover.role_code} role`)
              : 'Admin/Management'} (this contract's value falls under their approval tier).
          </span>
          {!isViewOnly(user) && <button type="button" onClick={handleWithdrawApproval}>Withdraw</button>}
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
              <div style={{ border: '1px solid #ddd', borderTop: 'none', maxHeight: 200, overflowY: 'auto' }}>
                {exhibitorResults.map((ex) => {
                  // A search reveals every matching exhibitor company-wide
                  // (see listExhibitors) so a duplicate under another rep is
                  // never invisible — but a non-elevated Sales user can only
                  // pick their own/unclaimed ones; another rep's shows here
                  // view-only, just to prove it already exists.
                  const ownedByOther = !['ADM', 'MGT'].includes(user?.role_code) && ex.salesperson_id && ex.salesperson_id !== user?.id;
                  return (
                    <div
                      key={ex.id}
                      onClick={() => { if (!ownedByOther) selectExhibitor(ex); }}
                      style={{
                        padding: 8, borderBottom: '1px solid #eee',
                        cursor: ownedByOther ? 'default' : 'pointer',
                        color: ownedByOther ? '#9099a8' : 'inherit',
                        display: 'flex', justifyContent: 'space-between', gap: 8,
                      }}
                      title={ownedByOther ? `Already assigned to ${ex.salesperson_name || 'another salesperson'} — view only` : undefined}
                    >
                      <span>{ex.company_name}</span>
                      {ex.salesperson_name && <span style={{ fontSize: 12, color: '#9099a8' }}>{ex.salesperson_name}</span>}
                    </div>
                  );
                })}
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
          onChange={(e) => {
            const tier = e.target.value;
            set('booking_type', tier);
            billingRef.current?.repriceAll(undefined, tier);
            if (!form.credit_terms_id) {
              const match = creditTerms.find((t) => t.default_for_tier === tier);
              if (match) set('credit_terms_id', match.id);
            }
          }}
        >
          <option value="">— Select —</option>
          <option value="PUBLISHED RATE">Published Rate</option>
          <option value="EARLY BIRD">Early Bird</option>
          <option value="ONSITE REBOOKING">Onsite Rebooking</option>
          <option value="CONTRA">Contra</option>
        </select>

        <label style={label}>Credit Terms</label>
        <select style={inputStyle} value={form.credit_terms_id || ''} onChange={(e) => set('credit_terms_id', e.target.value)}>
          <option value="">— None —</option>
          {creditTerms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>

        <label style={label}>Bill To (Contract/Invoice recipient name)</label>
        <select style={inputStyle} value={form.bill_to_type} onChange={(e) => set('bill_to_type', e.target.value)}>
          <option value="EXHIBITOR">Same as Exhibitor Name — {exhibitorName || '—'}</option>
          <option value="BILLING">Billing Company Name — {billToPreview.billingName || exhibitorName || '—'}</option>
          <option value="AGENT">Agent Name — {billToPreview.agentName || '(no agent assigned)'}</option>
        </select>

        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={label}>Hall</label>
            <input style={{ ...inputStyle, background: '#F5F6FA' }} value={form.hall} readOnly title="Derived from the booths picked on the Floor Plan below" />
          </div>
          <div style={{ flex: 1.5 }}>
            <label style={label}>Booth No</label>
            <input style={{ ...inputStyle, background: '#F5F6FA' }} value={form.booth_no} readOnly title="Derived from the booths picked on the Floor Plan below" />
          </div>
          <div style={{ flex: 1 }}>
            <label style={label}>Total Sqm</label>
            <input style={{ ...inputStyle, background: '#F5F6FA' }} value={form.total_sqm || 0} readOnly title="Derived from the booths picked on the Floor Plan below" />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={label}>Dimension (optional)</label>
            <input style={inputStyle} placeholder="e.g. 3m x 3m" value={form.dimension} onChange={(e) => set('dimension', e.target.value)} />
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end' }}>
            <button type="button" onClick={handlePickBooths} title="Pick booths on the Floor Plan" style={{ padding: 8, width: '100%', marginBottom: 12 }}>
              📍 Pick Booths on Floor Plan
            </button>
          </div>
        </div>
        {isNew && (
          <p style={{ fontSize: 12, color: '#5c6070', marginTop: -8 }}>Select an exhibitor above, then Pick Booths — Hall, Booth No and Total Sqm fill in from your selection, but nothing is saved until you click Save below.</p>
        )}

        <label style={label}>Remarks (any other information for this contract)</label>
        <textarea style={{ ...inputStyle, minHeight: 60 }} value={form.remarks} onChange={(e) => set('remarks', e.target.value)} />
        </fieldset>

        {editing && !isNew && <ChangesBanner changes={changes} />}

        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          {editing && (
            <button type="submit" disabled={saving} style={{ padding: '8px 16px' }}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          )}
          {/* Right at eye level next to Save, not buried up top — a
              validation failure (e.g. upgrade sqm over Bare Space) is
              impossible to miss here. */}
          {editing && error && (
            <span style={{ color: '#B23A3A', fontSize: 13, fontWeight: 600, background: '#FBE3E3', padding: '4px 10px', borderRadius: 6 }}>
              {error}
            </span>
          )}
          {!isNew && (
            <button type="button" onClick={handleViewContract} style={{ padding: '8px 16px' }}>
              View Contract
            </button>
          )}
          {!isNew && salesOrder?.status === 'APPROVED' && !isViewOnly(user) && (
            <button type="button" onClick={handlePickBooths} title="Relocate this contract's booth(s) on the Floor Plan" style={{ padding: '8px 16px' }}>
              📍 Change Booth
            </button>
          )}
          {canVoid && (
            <button type="button" onClick={handleVoid} style={{ padding: '8px 16px', color: '#B23A3A' }}>
              Void Contract
            </button>
          )}
          {!isNew && user?.role_code === 'ADM' && (
            <DeleteRecordButton type="contract" id={id} label="contract" onDeleted={() => navigate('/sales-orders')} />
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
          {salesOrder?.status === 'PENDING_APPROVAL' && (
            <p style={{ fontSize: 13, color: '#5c6070' }}>
              This contract is locked while pending approval — Withdraw it above if it needs to change.
            </p>
          )}
          {isLocked && salesOrder?.status === 'APPROVED' && (
            <p style={{ fontSize: 13, color: '#5c6070' }}>
              This contract is approved and locked — {canRequestReduction ? 'use Request Contract Reduction below to reduce it' : 'Void it if it needs to change and nothing has been invoiced yet'}.
              Need to relocate the booth itself? Use <strong>Change Booth</strong> above.
            </p>
          )}
          <BillingTemplate
            ref={billingRef}
            parentType="contract"
            parentId={id}
            currency={ccy}
            bookingType={form.booking_type}
            items={draftBillingItems || items}
            priceList={priceList}
            taxCodes={taxCodes}
            lodPct={lodPct}
            onSaved={() => { loadItems(); loadSalesOrder(); loadApprovalLog(); }}
            readOnly={isLocked}
            rightActions={canRequestReduction && (
              <button type="button" onClick={() => (showReductionForm ? setShowReductionForm(false) : openReductionForm())}>
                {showReductionForm ? 'Cancel' : '+ Request Contract Reduction'}
              </button>
            )}
          />
          {ccy === 'USD' && (
            <p style={{ textAlign: 'right', fontSize: 13, color: '#5c6070', marginTop: 4 }}>
              ≈ {fmt(salesOrder?.total_myr, 'MYR')} at the estimate rate (saved figure — updates after Save Billing)
            </p>
          )}

        </div>
      )}

      {!isNew && (showReductionForm || contractReductions.length > 0 || scheduledInvoices.length > 0) && (
        <div style={{ marginTop: 32 }}>
          {showReductionForm && (
            <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, marginTop: 16 }}>
              <h4 style={{ marginTop: 0 }}>{reductionEditingId ? 'Edit' : 'Request'} Contract Reduction</h4>
              <p style={{ fontSize: 12, color: '#5c6070' }}>
                Adjust quantities, rates, or remove rows below to reflect the newly agreed deal — the new contract
                total is computed automatically. If the new total no longer covers everything already confirmed-
                invoiced, a credit note for that shortfall is approved together with this request (issued
                afterward, against whichever invoice you pick then).
              </p>

              <label style={label}>Reason</label>
              <select style={inputStyle} value={reductionReasonCodeId} onChange={(e) => setReductionReasonCodeId(e.target.value)}>
                <option value="">— Select —</option>
                {reasonCodes.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>

              <label style={label}>Booking Type (rate tier) — change this to reprice the adjusted items below</label>
              <select
                style={inputStyle} value={reductionBookingType}
                onChange={(e) => { setReductionBookingType(e.target.value); reductionBillingRef.current?.repriceAll(undefined, e.target.value); }}
              >
                <option value="">— Select —</option>
                <option value="PUBLISHED RATE">Published Rate</option>
                <option value="EARLY BIRD">Early Bird</option>
                <option value="ONSITE REBOOKING">Onsite Rebooking</option>
                <option value="CONTRA">Contra</option>
              </select>

              <div style={{ marginTop: 16 }}>
                <BillingTemplate
                  ref={reductionBillingRef}
                  parentType="contract"
                  parentId={id}
                  currency={ccy}
                  bookingType={reductionBookingType}
                  items={reductionDraftItems || items}
                  priceList={priceList}
                  taxCodes={taxCodes}
                  lodPct={lodPct}
                  showSaveButton={false}
                  onSaved={() => {}}
                  onTotalChange={(total) => {
                    setReductionAdjustedTotal(total);
                    const snap = reductionBillingRef.current?.getSnapshot();
                    const bas = snap?.items.find((it) => it.sales_item_code === 'BAS');
                    setReductionAdjustedBasQty(bas ? Number(bas.qty) || 0 : 0);
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, padding: 12, background: '#F5F6FA', borderRadius: 8, flexWrap: 'wrap', gap: 8 }}>
                <span>Current: {fmt(contractTotal, ccy)} → New: {fmt(reductionAdjustedTotal ?? contractTotal, ccy)}</span>
                {(() => {
                  const newTotal = reductionAdjustedTotal ?? contractTotal;
                  const alreadyIssued = confirmedInvoices.reduce((s, inv) => s + Number(inv.amount_foreign), 0);
                  const cnNeeded = Math.max(0, alreadyIssued - newTotal);
                  return cnNeeded > 0.01 ? (
                    <strong style={{ color: '#8a1f1f' }}>Will need a credit note: {fmt(cnNeeded, ccy)}</strong>
                  ) : (
                    <strong style={{ color: '#1E7B34' }}>No credit note needed</strong>
                  );
                })()}
              </div>

              {reductionAdjustedBasQty !== null && reductionLinkedAllocatedSqm > 0 && (
                <div
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, padding: 12,
                    background: reductionNeedsBoothRelease ? '#FBE3E3' : '#E3F6E8', borderRadius: 8, flexWrap: 'wrap', gap: 8,
                  }}
                >
                  <span>
                    Booth allocation: <strong>{reductionRemainingAllocatedSqm} / {reductionAdjustedBasQty} sqm</strong>
                    {reductionNeedsBoothRelease
                      ? ' — release booths on the Floor Plan to match the adjusted Bare Space qty before this can be saved.'
                      : ' — matches the adjusted Bare Space qty.'}
                  </span>
                  <button type="button" onClick={handleAdjustReductionBooths}>Adjust Floor Plan Allocation</button>
                </div>
              )}

              <label style={label}>Notes (optional)</label>
              <textarea style={{ ...inputStyle, minHeight: 56 }} value={reductionNotes} onChange={(e) => setReductionNotes(e.target.value)} />

              {error && <p style={{ color: 'red', fontWeight: 600 }}>{error}</p>}
              <button type="button" onClick={handleRequestReduction} disabled={reductionBusy || reductionNeedsBoothRelease} style={{ marginTop: 12 }}>
                {reductionBusy ? 'Submitting...' : 'Submit Request'}
              </button>
            </div>
          )}

          {contractReductions.length > 0 && (
            <>
            <h3>Contract Reductions</h3>
            <table width="100%" cellPadding="6">
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                  <th>Requested</th><th>New Total</th><th>Credit Note</th><th>Reason</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {contractReductions.map((cr) => {
                  const cnAmount = Number(cr.cn_amount_myr) || 0;
                  const needsCnIssue = cr.status === 'APPROVED' && cnAmount > 0.01 && !cr.cn_issued_at;
                  return (
                  <tr key={cr.id} style={{ borderBottom: '1px solid #eee' }}>
                    <td>{new Date(cr.created_at).toLocaleDateString()}</td>
                    <td>{fmt(cr.old_total_foreign, ccy)} → {fmt(cr.new_total_foreign, ccy)}</td>
                    <td>
                      {cnAmount > 0.01
                        ? (cr.cn_issued_at ? `${fmt(cnAmount, 'MYR')} (issued)` : `${fmt(cnAmount, 'MYR')} pending`)
                        : '—'}
                    </td>
                    <td>{cr.reason_label || '—'}</td>
                    <td>{cr.status.replace('_', ' ')}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {cr.status === 'PENDING_APPROVAL' && (
                        <>
                          <button type="button" disabled={reductionBusy} onClick={() => handleApproveReduction(cr.id)}>Approve</button>{' '}
                          <button type="button" disabled={reductionBusy} onClick={() => handleRejectReduction(cr.id)}>Reject</button>{' '}
                          <button type="button" disabled={reductionBusy} onClick={() => openReductionFormForEdit(cr)}>Edit</button>{' '}
                          <button type="button" disabled={reductionBusy} onClick={() => handleWithdrawReduction(cr.id)}>Withdraw</button>
                        </>
                      )}
                      {needsCnIssue && (
                        issueCnForId === cr.id ? (
                          <>
                            <select style={{ ...inputStyle, width: 180, display: 'inline-block' }} value={issueCnInvoiceId} onChange={(e) => setIssueCnInvoiceId(e.target.value)}>
                              <option value="">— Select invoice —</option>
                              {confirmedInvoices.map((inv) => (
                                <option key={inv.id} value={inv.id}>{inv.invoice_no} — {fmt(inv.amount_myr, 'MYR')}</option>
                              ))}
                            </select>{' '}
                            <button type="button" disabled={reductionBusy} onClick={() => handleIssueReductionCn(cr.id)}>Confirm</button>{' '}
                            <button type="button" disabled={reductionBusy} onClick={() => { setIssueCnForId(null); setIssueCnInvoiceId(''); }}>Cancel</button>
                          </>
                        ) : (
                          <button type="button" disabled={reductionBusy} onClick={() => { setIssueCnForId(cr.id); setIssueCnInvoiceId(''); }}>Issue Credit Note</button>
                        )
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
            </>
          )}

          {scheduledInvoices.length > 0 && contractReductions.some((cr) => cr.status === 'APPROVED') && (() => {
            const leftover = Math.max(0, contractTotal - confirmedInvoices.reduce((s, inv) => s + Number(inv.amount_foreign), 0));
            const currentTotal = scheduledInvoices.reduce((s, inv) => {
              const edit = milestoneEdits[inv.id];
              return s + (edit ? Number(edit.amount) || 0 : Number(inv.amount_foreign));
            }, 0);
            const balanced = Math.abs(currentTotal - leftover) <= 0.01;
            return (
              <div style={{ marginTop: 16, padding: 12, border: '1px solid #ddd', borderRadius: 8 }}>
                <h4 style={{ marginTop: 0 }}>Remaining Milestone Billing</h4>
                <p style={{ fontSize: 12, color: '#5c6070' }}>
                  After a Contract Reduction, re-split whatever's still left to invoice ({fmt(leftover, ccy)}) across
                  the not-yet-issued milestone(s) below — enter either the amount or the % and the other fills in.
                </p>
                {scheduledInvoices.map((inv, i) => {
                  const edit = milestoneEdits[inv.id];
                  const amountVal = edit ? edit.amount : String(Number(inv.amount_foreign).toFixed(2));
                  const pctVal = edit ? edit.pct : (leftover > 0 ? String(((Number(inv.amount_foreign) / leftover) * 100).toFixed(2)) : '0');
                  return (
                    <div key={inv.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                      <span style={{ flex: 1, fontSize: 13 }}>Milestone {i + 1} (currently {fmt(inv.amount_foreign, ccy)})</span>
                      <input
                        type="number" step="0.01" style={{ ...inputStyle, width: 120 }} value={amountVal}
                        onChange={(e) => {
                          const amount = e.target.value;
                          const pct = leftover > 0 ? String(((Number(amount) || 0) / leftover * 100).toFixed(2)) : '0';
                          setMilestoneEdits((m) => ({ ...m, [inv.id]: { amount, pct } }));
                        }}
                      />
                      <span style={{ fontSize: 12, color: '#5c6070' }}>or</span>
                      <input
                        type="number" step="0.01" style={{ ...inputStyle, width: 90 }} value={pctVal}
                        onChange={(e) => {
                          const pct = e.target.value;
                          const amount = ((Number(pct) || 0) / 100 * leftover).toFixed(2);
                          setMilestoneEdits((m) => ({ ...m, [inv.id]: { amount, pct } }));
                        }}
                      />
                      <span style={{ fontSize: 12, color: '#5c6070' }}>%</span>
                    </div>
                  );
                })}
                <p style={{ fontSize: 13, fontWeight: 600, marginTop: 8, color: balanced ? '#1E7B34' : '#8a1f1f' }}>
                  Total: {fmt(currentTotal, ccy)} / {fmt(leftover, ccy)} {balanced ? '✓' : '— must match to save'}
                </p>
                <button type="button" onClick={handleSaveMilestoneRebalance} disabled={milestoneBusy || !balanced}>
                  {milestoneBusy ? 'Saving...' : 'Save Milestone Amounts'}
                </button>
              </div>
            );
          })()}
        </div>
      )}

      {!isNew && (
        <div style={{ marginTop: 32 }}>
          <h3>Attachments</h3>
          <p style={{ fontSize: 13, color: '#5c6070' }}>Upload the signed contract or any related document for audit/reference. Max 5MB per file (compress first if needed).</p>
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
                    <p style={{ fontSize: 12, color: '#5c6070', margin: '0 0 8px' }}>
                      Leave a line's date blank (or today/earlier) to issue it now — a future date parks it as a
                      scheduled milestone instead, with its own "Issue Invoice" button to trigger later. Percentages
                      must add up to exactly 100%.
                    </p>
                    {form.credit_terms_id && (
                      <button
                        type="button"
                        style={{ marginBottom: 8 }}
                        onClick={async () => {
                          const { splits } = await api.resolveCreditTermForContract(id);
                          if (splits && splits.length > 0) setMilestoneSplits(splits);
                          else window.alert("This contract's Credit Terms has no installments configured.");
                        }}
                      >
                        Pre-fill from this contract's Credit Terms
                      </button>
                    )}
                    <div style={{ display: 'flex', gap: 8, fontSize: 11, color: '#5c6070', marginBottom: 4 }}>
                      <span style={{ width: 80 }}>%</span>
                      <span style={{ width: 160 }}>Billing Date</span>
                      <span>Estimated Amount</span>
                    </div>
                    {milestoneSplits.map((s, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                        <input
                          type="number" step="0.01" style={{ ...inputStyle, width: 80 }}
                          value={s.pct}
                          onChange={(e) => {
                            const next = [...milestoneSplits];
                            next[i] = { ...next[i], pct: e.target.value };
                            setMilestoneSplits(next);
                          }}
                        />
                        <input
                          type="date" style={{ ...inputStyle, width: 160 }}
                          value={s.expected_billing_date}
                          onChange={(e) => {
                            const next = [...milestoneSplits];
                            next[i] = { ...next[i], expected_billing_date: e.target.value };
                            setMilestoneSplits(next);
                          }}
                        />
                        <span style={{ minWidth: 130 }}>{fmtCcy((remaining * (Number(s.pct) || 0)) / 100)}</span>
                        <span style={{ fontSize: 12, color: s.expected_billing_date && s.expected_billing_date > todayStr ? '#8a6d1a' : '#1E7B34' }}>
                          {s.expected_billing_date && s.expected_billing_date > todayStr ? 'Scheduled' : 'Issue now'}
                        </span>
                        <button type="button" onClick={() => setMilestoneSplits(milestoneSplits.filter((_, j) => j !== i))}>Remove</button>
                      </div>
                    ))}
                    <button type="button" onClick={() => setMilestoneSplits([...milestoneSplits, { pct: 0, expected_billing_date: '' }])}>+ Add Split</button>
                    <p style={{ fontSize: 12, fontWeight: 600, marginTop: 8 }}>
                      Total: {milestoneSplits.reduce((s, x) => s + (Number(x.pct) || 0), 0).toFixed(2)}%
                    </p>
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
                  <th>Invoice No</th><th>Date</th><th>Status</th><th>Milestone</th><th style={{ textAlign: 'right' }}>Amount</th><th></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const isScheduled = inv.status === 'SCHEDULED';
                  return (
                    <tr
                      key={inv.id}
                      onClick={() => !isScheduled && navigate(`/invoices/${inv.id}`)}
                      style={{ borderBottom: '1px solid #eee', cursor: isScheduled ? 'default' : 'pointer' }}
                    >
                      <td>{inv.invoice_no || '—'}</td>
                      <td>{isScheduled ? `Scheduled: ${inv.expected_billing_date}` : (inv.invoice_date || '—')}</td>
                      <td>
                        {isScheduled
                          ? <span style={{ color: '#8a6d1a' }}>SCHEDULED</span>
                          : inv.status === 'DRAFT' ? <span style={{ color: '#8a6d1a' }}>DRAFT</span> : 'Confirmed'}
                      </td>
                      <td>{inv.billing_pct ? `${Number(inv.billing_pct)}%` : '—'}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(inv.amount_foreign, inv.currency)}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {isScheduled && !isViewOnly(user) && (
                          <button type="button" onClick={(e) => { e.stopPropagation(); handleIssueScheduled(inv); }}>Issue Invoice</button>
                        )}
                        {(inv.status === 'DRAFT' || isScheduled) && !isViewOnly(user) && (
                          <>{' '}<button type="button" onClick={(e) => { e.stopPropagation(); handleWithdrawInvoice(inv); }}>Withdraw</button></>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {invoices.length === 0 && (
                  <tr><td colSpan={6}>Not invoiced yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        );
      })()}

      {!isNew && creditNotes.length > 0 && (() => {
        const CN_STATUS_STYLE = {
          PENDING_APPROVAL: { color: '#8a6d1a', label: 'Pending Approval' },
          DRAFT: { color: '#1B3A6B', label: 'Draft (awaiting Finance)' },
          CONFIRMED: { color: '#1A9C5B', label: 'Confirmed' },
          REJECTED: { color: '#c83c3c', label: 'Rejected' },
        };
        return (
          <div style={{ marginTop: 32 }}>
            <h3>Credit Notes</h3>
            <p style={{ fontSize: 12, color: '#5c6070' }}>
              Reduces one confirmed invoice's outstanding balance and — once approved — updates this contract's own
              committed sqm/items to match. Click a row for full detail, approval, attachments and Finance confirm.
            </p>
            <table width="100%" cellPadding="6">
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                  <th>CN No</th><th>Invoice</th><th>Reason</th><th style={{ textAlign: 'right' }}>Amount</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {creditNotes.map((cn) => (
                  <tr
                    key={cn.id}
                    onClick={() => navigate(`/credit-notes/${cn.id}`)}
                    style={{ borderBottom: '1px solid #eee', cursor: 'pointer' }}
                  >
                    <td>{cn.cn_no || '(pending)'}</td>
                    <td>{cn.invoice_no}</td>
                    <td style={{ fontSize: 12, color: '#5c6070' }}>{cn.reason_label || cn.reason || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(cn.amount_myr, 'MYR')}</td>
                    <td style={{ color: CN_STATUS_STYLE[cn.status]?.color, fontWeight: 600 }}>{CN_STATUS_STYLE[cn.status]?.label || cn.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}

      {!isNew && approvalLog.some((l) => ['APPROVED', 'REJECTED'].includes(l.action) || l.action.startsWith('CN_')) && (
        <div style={{ marginTop: 32 }}>
          <button type="button" onClick={() => setShowLog(!showLog)}>Approval History</button>
          {showLog && (
            <table width="100%" cellPadding="6" style={{ marginTop: 8 }}>
              <tbody>
                {approvalLog.filter((l) => ['APPROVED', 'REJECTED'].includes(l.action) || l.action.startsWith('CN_')).map((l) => (
                  <tr
                    key={l.id}
                    onClick={l.credit_note_id ? () => navigate(`/credit-notes/${l.credit_note_id}`) : undefined}
                    style={{ borderBottom: '1px solid #eee', cursor: l.credit_note_id ? 'pointer' : 'default' }}
                  >
                    <td style={{ fontWeight: 600 }}>{l.action}{l.credit_note_id ? ' (click to expand)' : ''}</td>
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
