import { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams, useSearchParams, useLocation } from 'react-router-dom';
import { api } from '../api/client';
import { useEventContext } from '../context/EventContext';
import { computeChanges, confirmSave, ChangesBanner, fieldsetStyle } from '../utils/recordForm';
import BillingTemplate, { UPGRADE_CODES, FIXED_LABELS } from '../components/BillingTemplate';
import { isViewOnly } from '../utils/permissions';
import { setUnsavedChanges } from '../utils/unsavedChanges';
import DeleteRecordButton from '../components/DeleteRecordButton';
import CorrespondenceLog from '../components/CorrespondenceLog';
import InfoTooltip from '../components/InfoTooltip';

const label = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, marginTop: 12 };
const inputStyle = { display: 'block', width: '100%', padding: 8, boxSizing: 'border-box' };
// Contract Sent / Won are set by the system as the deal moves through the
// contract's own approval/print/invoice flow — a user can't jump straight
// there by editing this dropdown, only advance through Initial Contact /
// Proposal Sent, or mark it Lost.
const SYSTEM_DRIVEN_STAGE_CODES = ['STG40', 'STG80', 'WON'];

export default function OpportunityDetail({ user }) {
  const { id } = useParams();
  const isElevated = ['ADM', 'MGT'].includes(user?.role_code);
  const isNew = !id;
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { events, selectedEventId } = useEventContext();

  const lockedExhibitorId = searchParams.get('exhibitor_id') || '';
  const lockedExhibitorName = searchParams.get('exhibitor_name') || '';

  // Returning from the Floor Plan's booth mass-pickup picker (see
  // handlePickBooths) — nothing is written to the database while picking;
  // the picker just hands back the selected booth set via location.state,
  // and it only actually saves once the user hits Save on THIS form (see
  // handleSubmit). The Floor Plan trip fully unmounts this page (a route
  // change), so any in-progress edits are stashed in sessionStorage first
  // and restored here — same pattern as the CN "adjust booths" flow.
  const pickedBooths = location.state?.pickedBooths;
  const boothAppliedRef = useRef(false);
  const draftKey = `oppDraft:${id || 'new'}`;

  const [form, setForm] = useState(() => ({
    exhibitor_id: lockedExhibitorId,
    event_id: selectedEventId,
    salesperson_id: '',
    stage_id: '',
    booking_type: '',
    currency: '',
    hall: '',
    booth_no: '',
    dimension: '',
    total_sqm: '',
    credit_terms_id: '',
    next_follow_up_date: '',
    remarks: '',
    bill_to_type: 'BILLING',
  }));
  const [exhibitorName, setExhibitorName] = useState(lockedExhibitorName);
  const [exhibitorSearch, setExhibitorSearch] = useState('');
  const [exhibitorResults, setExhibitorResults] = useState([]);

  const [stages, setStages] = useState([]);
  const [salespeople, setSalespeople] = useState([]);
  const [priceList, setPriceList] = useState([]);
  // Which sales_item_code drives Total Sqm on this event — see
  // BillingTemplate.jsx's is_primary_base; falls back to 'BAS'.
  const primaryBaseCode = priceList.find((p) => p.is_primary_base)?.sales_item_code || 'BAS';
  const [creditTerms, setCreditTerms] = useState([]);
  const [taxCodes, setTaxCodes] = useState([]);
  const [lodPct, setLodPct] = useState(15);
  const [stampDuty, setStampDuty] = useState(null);
  const [items, setItems] = useState([]);
  const [original, setOriginal] = useState(null);
  const [editing, setEditing] = useState(isNew);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [existingSalesOrderId, setExistingSalesOrderId] = useState(null);
  const [existingOpportunities, setExistingOpportunities] = useState([]);
  // Just for the Bill To dropdown hint (which name each option actually
  // resolves to) — not saved anywhere itself, re-fetched whenever the
  // exhibitor changes.
  const [billToPreview, setBillToPreview] = useState({ billingName: '', agentName: '' });
  const [stageChangedAt, setStageChangedAt] = useState(null);
  const [needsReallocation, setNeedsReallocation] = useState(false);
  const [hasPendingValueChange, setHasPendingValueChange] = useState(false);
  // null = not loaded yet — kept distinct from [] (genuinely zero booths) so
  // the sync-to-form effect below never overwrites hall/booth_no with a
  // premature blank before the real set has actually arrived. This is now
  // the STAGED set (may not match the database until Save) rather than a
  // live server mirror — see handleSubmit for where it actually commits.
  const [linkedBooths, setLinkedBooths] = useState(null);
  // Server-loaded baseline for linkedBooths (id + allocated_item_code only) —
  // used solely by the unsaved-changes dirty-check below, since a booth
  // selection or per-booth type change (e.g. Bare Space -> WOP) doesn't
  // always move Hall/Booth No/Total Sqm (same booths, different type), so
  // computeChanges(original, form) alone can miss it (2026-07-31 bug report:
  // user left the screen with an unsaved booth-type change and got no
  // warning).
  const [originalLinkedBooths, setOriginalLinkedBooths] = useState(null);
  // Overrides the normal server-loaded `items` when restoring a draft after
  // a Floor Plan round trip (see draftKey above) — BillingTemplate reseeds
  // its rows from whichever of these two is passed as its `items` prop.
  const [draftBillingItems, setDraftBillingItems] = useState(null);
  const billingRef = useRef(null);

  function loadItems() {
    if (!id) return;
    api.listOpportunityItems(id).then(({ items }) => setItems(items));
  }

  useEffect(() => {
    Promise.all([api.listStages(), api.listSalespeople(), api.listTaxCodes()]).then(([st, sp, tc]) => {
      setStages(st.stages);
      setSalespeople(sp.salespeople);
      setTaxCodes(tc.taxCodes);
      setForm((f) => (f.stage_id ? f : { ...f, stage_id: st.stages[0]?.id || '' }));
    });
    api.getSettings().then(({ settings }) => {
      setLodPct(settings?.lod_pct_of_bas ?? 15);
      setStampDuty({
        enabled: settings?.stamp_duty_enabled || false,
        rate_pct: settings?.stamp_duty_rate_pct ?? 0.5,
        round_to: settings?.stamp_duty_round_to ?? 5,
        minimum: settings?.stamp_duty_minimum ?? 10,
      });
    });
  }, []);

  // Loads the record fresh (or, for a brand-new one, just leaves the default
  // blank form) — UNLESS a draft was stashed in sessionStorage right before
  // a Floor Plan trip (see handlePickBooths), in which case that draft wins:
  // it's strictly more recent than whatever's on the server, since it holds
  // edits the user hadn't saved yet when they left for the picker.
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
      setOriginalLinkedBooths([]);
      return;
    }

    api.getOpportunity(id).then(({ opportunity }) => {
      const loaded = {
        exhibitor_id: opportunity.exhibitor_id,
        event_id: opportunity.event_id,
        salesperson_id: opportunity.salesperson_id || '',
        stage_id: opportunity.stage_id,
        booking_type: opportunity.booking_type || '',
        currency: opportunity.currency || 'MYR',
        hall: opportunity.hall || '',
        booth_no: opportunity.booth_no || '',
        dimension: opportunity.dimension || '',
        total_sqm: opportunity.total_sqm ?? '',
        credit_terms_id: opportunity.credit_terms_id || '',
        next_follow_up_date: opportunity.next_follow_up_date || '',
        remarks: opportunity.remarks || '',
        bill_to_type: opportunity.bill_to_type || 'BILLING',
      };
      setOriginal(loaded);
      setExistingSalesOrderId(opportunity.existing_sales_order_id || null);
      setLoading(false);
      if (draft) {
        applyDraft();
      } else {
        setForm(loaded);
        setExhibitorName(opportunity.exhibitor_name);
        setBillToPreview({ billingName: opportunity.billing_name || '', agentName: opportunity.agent_name || '' });
        setStageChangedAt(opportunity.stage_changed_at);
        setNeedsReallocation(opportunity.needs_booth_reallocation);
        setHasPendingValueChange(opportunity.has_pending_value_change);
        loadItems();
        api.listOpportunityBooths(id).then(({ booths }) => {
          setLinkedBooths(booths);
          setOriginalLinkedBooths(booths);
        });
      }
    });
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
  // columns for the print pages and Contracts list that read them directly.
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
    // Sum sqm per tagged type (untagged booths count as Bare Space — the
    // same default as before this feature existed) — see FloorPlan.jsx's
    // per-booth type tagging in the cap-mode picker.
    const byType = {};
    for (const b of linkedBooths) {
      const code = b.allocated_item_code || primaryBaseCode;
      byType[code] = (byType[code] || 0) + (Number(b.sqm) || 0);
    }
    const isCorner = linkedBooths.some((b) => b.is_corner);
    const isLoading = linkedBooths.some((b) => b.is_loading);
    // Any other admin-flagged is_booth_related item tagged per-booth on the
    // Floor Plan (see FloorPlan.jsx's booth editor, migration 070) — Corner/
    // Loading stay on their own dedicated flags above.
    const boothAddonCodes = [...new Set(
      priceList.filter((p) => p.is_booth_related && p.sales_item_code !== 'COR' && p.sales_item_code !== 'LOD').map((p) => p.sales_item_code)
    )];
    const byAddon = {};
    for (const code of boothAddonCodes) {
      byAddon[code] = linkedBooths.filter((b) => (b.addon_codes || []).includes(code)).length;
    }
    billingRef.current.applyBoothAllocation({ byType, isCorner, isLoading, byAddon });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedBooths, priceList, pickedBooths]);

  // EventContext loads the event list asynchronously — on a fresh page load
  // (e.g. navigating straight to /opportunities/new), this component can
  // mount and seed form.event_id from selectedEventId before that fetch
  // resolves, leaving it permanently blank since nothing else re-syncs it.
  // Backfill once selectedEventId actually arrives, but only for a new
  // record and only if nothing else (a locked query param) already set it.
  useEffect(() => {
    if (isNew && !form.event_id && selectedEventId) set('event_id', selectedEventId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, selectedEventId]);

  useEffect(() => {
    if (!form.event_id) return;
    api.listPriceList(form.event_id).then(({ priceList }) => setPriceList(priceList));
    api.listCreditTerms(form.event_id).then(({ creditTerms }) => setCreditTerms(creditTerms));
  }, [form.event_id]);

  // A brand-new opportunity's exhibitor+event combination may already have
  // one — flagged so Sales can open the existing one instead of accidentally
  // splitting one deal into two records, which would double-count it in the
  // win/loss conversion rate. Purely a heads-up, not a block: the user can
  // still continue creating a new one below (see item 5's rule — an
  // exhibitor can legitimately run more than one live opportunity at once).
  useEffect(() => {
    if (!isNew || !form.exhibitor_id || !form.event_id) { setExistingOpportunities([]); return; }
    api.listOpportunities({ exhibitor_id: form.exhibitor_id, event_id: form.event_id }).then(({ opportunities }) => {
      setExistingOpportunities(opportunities || []);
    });
  }, [isNew, form.exhibitor_id, form.event_id]);

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

  // A rep can only ever be initiating contact as themselves — no picking an
  // arbitrary colleague off a dropdown. Admin/Management still get the full
  // dropdown since they may need to reassign leads. New opportunities
  // default to the exhibitor account's assigned salesperson rather than
  // Unassigned (covers both picking one from the search dropdown and
  // arriving here already locked to an exhibitor) — and RE-derives it every
  // time the exhibitor changes (not just once when blank), since switching
  // from Company A to Company B while still drafting a new opportunity
  // should carry over Company B's own rep, not leave Company A's behind.
  // Deliberately keyed only on exhibitor_id changing (not a general re-run),
  // so a manual salesperson pick made afterward for the SAME exhibitor is
  // never overwritten.
  useEffect(() => {
    if (!isNew || !form.exhibitor_id) return;
    if (!isElevated) {
      if (user?.id) set('salesperson_id', user.id);
      return;
    }
    api.getExhibitor(form.exhibitor_id).then(({ exhibitor }) => {
      set('salesperson_id', exhibitor.salesperson_id || '');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, form.exhibitor_id, isElevated]);

  // Bill To preview — which real name each option would resolve to. Runs for
  // any exhibitor pick (new record), independent of the elevated-only
  // salesperson-derivation effect above.
  useEffect(() => {
    if (!isNew || !form.exhibitor_id) return;
    api.getExhibitor(form.exhibitor_id).then(({ exhibitor }) => {
      setBillToPreview({ billingName: exhibitor.billing_name || '', agentName: exhibitor.agent_name || '' });
    });
  }, [isNew, form.exhibitor_id]);

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

  // True if the current booth selection (which booths, and each one's
  // allocated type) differs from what was actually loaded from the server —
  // catches a booth-type swap or add/remove that didn't happen to move
  // Hall/Booth No/Total Sqm, which computeChanges alone would miss.
  function boothsChanged() {
    if (!linkedBooths || !originalLinkedBooths) return false;
    const snap = (list) => list.map((b) => `${b.id}:${b.allocated_item_code || ''}`).sort().join('|');
    return snap(linkedBooths) !== snap(originalLinkedBooths);
  }

  // Warns before the user navigates away (nav bar links, tab close/refresh)
  // with unsaved edits — cleared on unmount so it never leaks onto the next
  // page after a confirmed discard or a successful Save.
  useEffect(() => {
    const isDirty = editing && (isNew
      ? Boolean(exhibitorName)
      : changes.length > 0 || boothsChanged());
    setUnsavedChanges(isDirty, 'You have unsaved opportunity changes that will be lost if you leave. Continue?');
    return () => setUnsavedChanges(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, isNew, changes.length, exhibitorName, linkedBooths, originalLinkedBooths]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!form.exhibitor_id) {
      setError('Please select an exhibitor.');
      return;
    }

    // Marking a deal Lost is a bigger consequence than a normal field edit,
    // so it gets its own confirmation instead of the generic changed-values
    // one. If this exhibitor has no OTHER open (or Won) opportunity left
    // after this, the account is released back to the pool for another rep
    // to pick up — handled server-side in updateOpportunity, since it needs
    // to see every opportunity on the account, not just this rep's own.
    const lostStage = stages.find((s) => s.code === 'LOSE');
    const movingToLost = !isNew && lostStage && form.stage_id === lostStage.id && original?.stage_id !== lostStage.id;

    if (movingToLost) {
      if (!window.confirm(`Mark this opportunity Lost? If ${exhibitorName} has no other open opportunity, the account will be unassigned from you and opened up for another salesperson to follow up.`)) return;
    } else if (!confirmSave(changes, 'opportunity', isNew)) {
      return;
    }

    setSaving(true);
    try {
      // Booths picked on the Floor Plan are staged locally only (see
      // handlePickBooths) — nothing is written to the database until here,
      // as part of this same Save, so leaving the form without saving never
      // touches the booth's real record or creates a phantom opportunity.
      const boothIds = (linkedBooths || []).map((b) => b.id);
      const boothItemCodes = Object.fromEntries((linkedBooths || []).map((b) => [b.id, b.allocated_item_code || null]));
      if (isNew) {
        const { opportunity } = await api.createOpportunity(form);
        // Booth links (and their BAS/upgrade type tagging) must land before
        // the billing sync below, since billing derives Total Sqm and its
        // rows from whichever booths/types are actually linked — syncing
        // billing first raced against the still-stale booth link and could
        // reject the save with a stale-cap error (see 2026-07-31 bug report).
        await api.bulkSetOpportunityBooths(opportunity.id, { floor_plan_booth_ids: boothIds, booth_item_codes: boothItemCodes, exhibitor_name: exhibitorName });
        // Billing lines were entered on this same form before the record
        // existed — sync them to the new id now, as part of this one Save.
        await billingRef.current?.save(opportunity.id);
        // First rep to touch an unclaimed account becomes its owner.
        const { exhibitor } = await api.getExhibitor(form.exhibitor_id);
        if (!exhibitor.salesperson_id && form.salesperson_id) {
          await api.updateExhibitor(form.exhibitor_id, { salesperson_id: form.salesperson_id });
        }
        navigate(`/opportunities/${opportunity.id}`);
      } else {
        await api.updateOpportunity(id, form);
        await api.bulkSetOpportunityBooths(id, { floor_plan_booth_ids: boothIds, booth_item_codes: boothItemCodes, exhibitor_name: exhibitorName });
        await billingRef.current?.save(id);
        navigate('/opportunities');
      }
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  // Hands off to the Floor Plan's mass-pickup picker (see FloorPlan.jsx's
  // 'cap' pickFor mode) — the picker only stages a selection and hands it
  // back via location.state; nothing is written to the database until the
  // user actually hits Save on this form (see handleSubmit). Works the same
  // way whether this is a brand-new, never-saved opportunity or an existing
  // one — no record needs to exist yet just to try out a booth pick. The
  // Floor Plan trip fully remounts this page, so the in-progress form (and
  // any billing rows already entered) is stashed in sessionStorage first and
  // restored on the way back. No cap is passed — Total Sqm is derived FROM
  // the selection (see the linkedBooths effect above), not a pre-set target.
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
    // Every admin-configured Upgrade option — offered per-booth in the Floor
    // Plan picker's own type dropdown (see FloorPlan.jsx), always shown for
    // every selected booth so Sales sets the real type up front.
    const upgradeCodes = [...UPGRADE_CODES];
    for (const p of priceList) if (p.is_upgrade_option && !upgradeCodes.includes(p.sales_item_code)) upgradeCodes.push(p.sales_item_code);
    const upgradeOptions = upgradeCodes.map((code) => ({
      code, label: priceList.find((p) => p.sales_item_code === code)?.description || FIXED_LABELS[code] || code,
    }));
    navigate('/floor-plan', {
      state: {
        pickFor: {
          mode: 'cap',
          recordType: 'opportunity',
          recordId: isNew ? null : id,
          returnPath: isNew ? '/opportunities/new' : `/opportunities/${id}`,
          exhibitorName,
          preSelectedBooths: linkedBooths || [],
          cap: null,
          upgradeOptions,
        },
      },
    });
  }

  // Proposal Sent is system-driven, same reasoning as Contract Sent on the
  // Contract page (see SalesOrderDetail.jsx's promptMoveOpportunityStage) —
  // viewing/printing the Proposal document means it's actually been sent to
  // the exhibitor. Only prompts the FIRST time (still at Initial Contact);
  // re-viewing it afterward is just a reprint, nothing to confirm again.
  async function handleViewProposal() {
    const proposalStage = stages.find((s) => s.code === 'STG40');
    const initialStage = stages.find((s) => s.code === 'STG10');
    if (proposalStage && form.stage_id === initialStage?.id) {
      if (window.confirm("Mark this opportunity as 'Proposal Sent'? This locks the stage from being changed back manually.")) {
        await api.updateOpportunity(id, { stage_id: proposalStage.id });
        set('stage_id', proposalStage.id);
        setOriginal((o) => (o ? { ...o, stage_id: proposalStage.id } : o));
        setStageChangedAt(new Date().toISOString());
      }
    }
    navigate(`/opportunities/${id}/proposal`);
  }

  // Contracts are only ever created by transferring an approved opportunity
  // — this carries the quoted line items across so Sales doesn't have to
  // re-enter them, then lands on the new Contract to review before saving.
  async function handleGenerateContract() {
    // Tax/registration detail is only ever asked for once a deal is real
    // enough to invoice — but it MUST be there before a Contract exists,
    // since the Contract/Invoice documents need it. Malaysia-registered
    // exhibitors are checked here; other countries have no equivalent
    // mandatory field today.
    const { exhibitor } = await api.getExhibitor(form.exhibitor_id);
    if (exhibitor.country_code === 'MY' && (!exhibitor.reg_no || !exhibitor.tin_no)) {
      if (window.confirm(`${exhibitorName}'s Reg. No / TIN No. are still missing — these are needed before a Contract can be generated. Open the Exhibitor page now to complete them or send a self-service link?`)) {
        navigate(`/exhibitors/${form.exhibitor_id}`);
      }
      return;
    }
    if (!window.confirm('Create a Draft Contract from this opportunity? It stays a freely-editable Draft until you explicitly send it for approval — nothing is submitted yet.')) return;
    setTransferring(true);
    setError('');
    try {
      const { salesOrder } = await api.createSalesOrder({
        exhibitor_id: form.exhibitor_id,
        event_id: form.event_id,
        opportunity_id: id,
        salesperson_id: form.salesperson_id,
        currency: form.currency,
        booking_type: form.booking_type,
        hall: form.hall,
        booth_no: form.booth_no,
        dimension: form.dimension,
        total_sqm: form.total_sqm,
        credit_terms_id: form.credit_terms_id,
      });
      for (const it of items) {
        await api.addSalesOrderItem(salesOrder.id, {
          sales_item_code: it.sales_item_code,
          description: it.description,
          category: it.category,
          qty: it.qty,
          unit_price: it.unit_price,
          discount_type: it.discount_type,
          discount_value: it.discount_value,
          tax_code_id: it.tax_code_id,
        });
      }
      navigate(`/sales-orders/${salesOrder.id}`);
    } catch (err) {
      setError(err.message);
      setTransferring(false);
      if (err.existingSalesOrderId) setExistingSalesOrderId(err.existingSalesOrderId);
    }
  }

  if (loading) return <p style={{ maxWidth: 1100, margin: '40px auto' }}>Loading...</p>;

  return (
    <div className="page" style={{ maxWidth: 1100, margin: '40px auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {isNew ? 'Add Opportunity' : editing ? 'Edit Opportunity' : 'Opportunity'}
          {hasPendingValueChange && (
            <span style={{ background: '#FFF3BF', color: '#8a6d1a', padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600 }}>
              VALUE CHANGE PENDING
            </span>
          )}
        </h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {!isNew && !editing && !isViewOnly(user) && <button type="button" onClick={() => setEditing(true)}>Edit</button>}
          <button type="button" onClick={() => navigate('/opportunities')}>Back to list</button>
        </div>
      </div>
      {error && <p style={{ color: 'red', fontWeight: 600 }}>{error}</p>}
      {needsReallocation && (
        <div style={{ background: '#FBE3E3', border: '1px solid #E5A0A0', borderRadius: 8, padding: 12, margin: '8px 0' }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#8a1f1f' }}>
            A booth this opportunity was proposing went to another contract that got approved first — please pick a
            replacement booth on the Floor Plan as soon as possible.
          </p>
          <button type="button" onClick={handlePickBooths} style={{ marginTop: 8 }}>Pick Booths on Floor Plan</button>
        </div>
      )}

      <form id="opportunity-form" onSubmit={handleSubmit}>
        <fieldset disabled={!editing} style={fieldsetStyle}>
        <label style={label}>Exhibitor *</label>
        {lockedExhibitorId ? (
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
                  const ownedByOther = !isElevated && ex.salesperson_id && ex.salesperson_id !== user?.id;
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

        {isNew && existingOpportunities.length > 0 && (
          <div style={{ background: '#FFF3BF', border: '1px solid #F0C36D', borderRadius: 8, padding: 12, margin: '12px 0' }}>
            <strong>{exhibitorName}</strong> already has {existingOpportunities.length} opportunit{existingOpportunities.length === 1 ? 'y' : 'ies'} for this event —
            splitting the same deal across two records will double-count it in the win/loss conversion rate.
            <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
              {existingOpportunities.map((o) => (
                <li key={o.id}>
                  <a href={`/opportunities/${o.id}`} onClick={(e) => { e.preventDefault(); navigate(`/opportunities/${o.id}`); }}>
                    {o.stage_name}
                  </a>
                  {o.salesperson_name ? ` — ${o.salesperson_name}` : ''}
                </li>
              ))}
            </ul>
            <p style={{ margin: '6px 0 0', fontSize: 13 }}>Open one of these instead, or continue below if this is genuinely a separate proposal.</p>
          </div>
        )}

        <label style={label}>Event (main event)</label>
        <select style={inputStyle} value={form.event_id} onChange={(e) => set('event_id', e.target.value)}>
          {isNew
            ? events.filter((ev) => !ev.parent_event_id).map((ev) => (
                <option key={ev.id} value={ev.id}>{ev.name}</option>
              ))
            // Existing opportunities may predate this rule and still sit
            // under a sub-event — keep the full hierarchy available so the
            // view doesn't go blank for them.
            : events
                .filter((ev) => !ev.parent_event_id)
                .flatMap((main) => [main, ...events.filter((ev) => ev.parent_event_id === main.id)])
                .map((ev) => (
                  <option key={ev.id} value={ev.id}>{ev.parent_event_id ? `— ${ev.name}` : ev.name}</option>
                ))}
        </select>

        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={label}>Stage</label>
            <select style={inputStyle} value={form.stage_id} onChange={(e) => set('stage_id', e.target.value)}>
              {stages.map((s) => (
                <option key={s.id} value={s.id} disabled={SYSTEM_DRIVEN_STAGE_CODES.includes(s.code)}>
                  {s.name}{SYSTEM_DRIVEN_STAGE_CODES.includes(s.code) ? ' (set automatically)' : ''}
                </option>
              ))}
            </select>
            {stageChangedAt && (
              <p style={{ fontSize: 11, color: '#5c6070', margin: '2px 0 0' }}>
                Since {new Date(stageChangedAt).toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
            )}
          </div>
          <div style={{ flex: 1 }}>
            <label style={label}>Salesperson</label>
            {isElevated ? (
              <select style={inputStyle} value={form.salesperson_id} onChange={(e) => set('salesperson_id', e.target.value)}>
                <option value="">— Unassigned —</option>
                {salespeople.map((s) => (
                  <option key={s.id} value={s.id}>{s.full_name}</option>
                ))}
              </select>
            ) : (
              <div style={{ padding: 8, background: '#F5F6FA', borderRadius: 4 }}>
                {salespeople.find((s) => s.id === form.salesperson_id)?.full_name || user?.full_name || '—'}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={label}>Tier *</label>
            <select
              style={inputStyle} value={form.booking_type} required
              onChange={(e) => {
                const tier = e.target.value;
                set('booking_type', tier);
                billingRef.current?.repriceAll(undefined, tier);
                // Suggest the Tier's default Credit Terms — only when
                // nothing's been explicitly chosen yet, so this never
                // silently overrides a deliberate pick.
                if (!form.credit_terms_id) {
                  const match = creditTerms.find((t) => t.default_for_tier === tier);
                  if (match) set('credit_terms_id', match.id);
                }
              }}
            >
              <option value="">— Select —</option>
              {/* Derived from the event's own Price List (same pattern as
                  PriceList.jsx's own tier list) — was a hardcoded 4-option
                  list before, which kept showing "Onsite Rebooking" even
                  for a company/event whose Price List doesn't have that
                  tier at all (caught live in production, 2026-08-05). */}
              {/* 'ALL TIERS' is a per-item wildcard (see BillingTemplate.jsx —
                  Badge/Loading/Others/etc. price the same on every real
                  tier), not itself a bookable tier a contract can be on. */}
              {[...new Set(priceList.map((p) => p.booth_type))].filter((t) => t && t !== 'ALL TIERS').map((tier) => (
                <option key={tier} value={tier}>{tier}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={label}>Currency *</label>
            <select
              style={inputStyle} value={form.currency} disabled={!isNew && items.length > 0} required
              onChange={(e) => { set('currency', e.target.value); billingRef.current?.repriceAll(e.target.value, undefined); }}
            >
              <option value="">— Select —</option>
              <option value="MYR">MYR</option>
              <option value="USD">USD</option>
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={label}>Credit Terms</label>
            <select style={inputStyle} value={form.credit_terms_id} onChange={(e) => set('credit_terms_id', e.target.value)}>
              <option value="">— None —</option>
              {creditTerms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={label}>Bill To (Proposal recipient name)</label>
            <select style={inputStyle} value={form.bill_to_type} onChange={(e) => set('bill_to_type', e.target.value)}>
              <option value="EXHIBITOR">Exhibitor Name — {exhibitorName || '—'}</option>
              <option value="BILLING">Billing Company Name — {billToPreview.billingName || exhibitorName || '—'}</option>
              <option value="AGENT">Agent Name — {billToPreview.agentName || '(no agent assigned)'}</option>
            </select>
          </div>
        </div>

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
          <div style={{ flex: 1 }}>
            {/* Matches the Dimension label's own height so the button below
                starts at the exact same row as the Dimension input, instead
                of sitting a label's-height higher (2026-08-01 user report:
                the two boxes weren't level with each other). */}
            <label style={label}>&nbsp;</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={handlePickBooths} title="Pick booths on the Floor Plan" style={{ padding: 8, flex: 1 }}>
                📍 Pick Booths on Floor Plan
              </button>
              {isNew && (
                <InfoTooltip
                  text="Select an exhibitor above, then Pick Booths — Hall, Booth No and Total Sqm fill in from your selection, but nothing is saved until you click Save below."
                />
              )}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 20 }}>
          <h3 style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
            Billing (estimate)
            <InfoTooltip text={'Booth type and sqm are controlled entirely by your Floor Plan booth selection above — pick booths (and each one’s type) there; billing below follows automatically. MEP, Sponsorship, Other and Badge stay optional add-ons you can still toggle manually. This is saved together with the details above, and carries across to the Contract when you click "Generate Contract".'} />
          </h3>
          <BillingTemplate
            ref={billingRef}
            parentType="opportunity"
            parentId={id}
            currency={form.currency}
            bookingType={form.booking_type}
            items={draftBillingItems || items}
            priceList={priceList}
            taxCodes={taxCodes}
            lodPct={lodPct}
            stampDuty={stampDuty}
            onSaved={loadItems}
            showSaveButton={false}
          />
        </div>

        <label style={label}>Remarks</label>
        <textarea style={{ ...inputStyle, minHeight: 48 }} value={form.remarks} onChange={(e) => set('remarks', e.target.value)} />
        </fieldset>
      </form>

      {/* CorrespondenceLog renders its own <form> internally, so it has to
          sit outside the Opportunity form's own <form> tag (nested forms are
          invalid HTML) — placed here, between Remarks and Next Follow-up
          Date, to match the reading order the user asked for. The Save
          button below is still wired to the Opportunity form via its
          form="opportunity-form" attribute, so submitting works exactly the
          same as if this were all one form. */}
      {!isNew && <CorrespondenceLog entityType="opportunity" entityId={id} />}

      <div>
        <label style={label}>Next Follow-up Date</label>
        <input
          type="date" style={inputStyle} disabled={!editing} value={form.next_follow_up_date}
          onChange={(e) => set('next_follow_up_date', e.target.value)}
        />
      </div>

      {editing && !isNew && <ChangesBanner changes={changes} />}

      <div style={{ display: 'flex', gap: 8, marginTop: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        {editing && (
          <button type="submit" form="opportunity-form" disabled={saving} style={{ padding: '8px 16px' }}>
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
          <button type="button" onClick={handleViewProposal} style={{ padding: '8px 16px' }}>
            View Proposal
          </button>
        )}
        {!isNew && !isViewOnly(user) && (
          existingSalesOrderId ? (
            <button type="button" onClick={() => navigate(`/sales-orders/${existingSalesOrderId}`)} style={{ padding: '8px 16px' }}>
              View Contract
            </button>
          ) : (
            <button type="button" disabled={transferring} onClick={handleGenerateContract} style={{ padding: '8px 16px' }}>
              {transferring ? 'Creating...' : 'Generate Draft Contract'}
            </button>
          )
        )}
        {!isNew && user?.role_code === 'ADM' && (
          <DeleteRecordButton type="opportunity" id={id} label="opportunity" onDeleted={() => navigate('/opportunities')} />
        )}
      </div>
    </div>
  );
}
