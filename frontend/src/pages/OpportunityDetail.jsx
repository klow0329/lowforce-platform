import { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams, useSearchParams, useLocation } from 'react-router-dom';
import { api } from '../api/client';
import { useEventContext } from '../context/EventContext';
import { computeChanges, confirmSave, ChangesBanner, fieldsetStyle } from '../utils/recordForm';
import BillingTemplate from '../components/BillingTemplate';
import { isViewOnly } from '../utils/permissions';

const label = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, marginTop: 12 };
const inputStyle = { display: 'block', width: '100%', padding: 8, boxSizing: 'border-box' };
// Contract Sent / Won are set by the system as the deal moves through the
// contract's own approval/print/invoice flow — a user can't jump straight
// there by editing this dropdown, only advance through Initial Contact /
// Proposal Sent, or mark it Lost.
const SYSTEM_DRIVEN_STAGE_CODES = ['STG80', 'WON'];

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

  // Returning from the Floor Plan booth picker (see handlePickFromFloorPlan)
  // — a picked booth's Hall/Booth No/Dimension, and for a brand-new record
  // that hadn't been saved yet, the rest of the form the user had already
  // filled in before they navigated away to pick a booth.
  const pickedBooth = location.state?.pickedBooth;
  const restoreSnapshot = location.state?.formSnapshot;
  const boothAppliedRef = useRef(false);

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
    next_follow_up_date: '',
    remarks: '',
    ...(restoreSnapshot?.form || {}),
    ...(pickedBooth ? { hall: pickedBooth.hall, booth_no: pickedBooth.booth_no, dimension: pickedBooth.dimension } : {}),
  }));
  const [exhibitorName, setExhibitorName] = useState(restoreSnapshot?.exhibitorName || lockedExhibitorName);
  const [exhibitorSearch, setExhibitorSearch] = useState('');
  const [exhibitorResults, setExhibitorResults] = useState([]);

  const [stages, setStages] = useState([]);
  const [salespeople, setSalespeople] = useState([]);
  const [priceList, setPriceList] = useState([]);
  const [taxCodes, setTaxCodes] = useState([]);
  const [items, setItems] = useState([]);
  const [original, setOriginal] = useState(null);
  const [editing, setEditing] = useState(isNew);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [transferring, setTransferring] = useState(false);
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
  }, []);

  useEffect(() => {
    if (isNew) return;
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
        next_follow_up_date: opportunity.next_follow_up_date || '',
        remarks: opportunity.remarks || '',
      };
      setOriginal(loaded);
      // A picked booth is a pending edit, not yet saved — applied on top of
      // the loaded record so the ChangesBanner correctly shows it as
      // something the user still needs to click Save to persist.
      setForm(pickedBooth ? { ...loaded, hall: pickedBooth.hall, booth_no: pickedBooth.booth_no, dimension: pickedBooth.dimension } : loaded);
      setExhibitorName(opportunity.exhibitor_name);
      setLoading(false);
    });
    loadItems();
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

  // A rep can only ever be initiating contact as themselves — no picking an
  // arbitrary colleague off a dropdown. Admin/Management still get the full
  // dropdown since they may need to reassign leads. New opportunities
  // default to the exhibitor account's assigned salesperson rather than
  // Unassigned (covers both picking one from the search dropdown and
  // arriving here already locked to an exhibitor).
  useEffect(() => {
    if (!isNew || !form.exhibitor_id || form.salesperson_id) return;
    if (!isElevated) {
      if (user?.id) set('salesperson_id', user.id);
      return;
    }
    api.getExhibitor(form.exhibitor_id).then(({ exhibitor }) => {
      if (exhibitor.salesperson_id) set('salesperson_id', exhibitor.salesperson_id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, form.exhibitor_id, isElevated]);

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

    // Marking a deal Lost releases the exhibitor account back to the pool
    // for another rep to pick up — that's a bigger consequence than a
    // normal field edit, so it gets its own confirmation instead of the
    // generic changed-values one.
    const lostStage = stages.find((s) => s.code === 'LOSE');
    const movingToLost = !isNew && lostStage && form.stage_id === lostStage.id && original?.stage_id !== lostStage.id;

    if (movingToLost) {
      if (!window.confirm(`Mark this opportunity Lost? ${exhibitorName} will be unassigned from you and opened up for another salesperson to follow up.`)) return;
    } else if (!confirmSave(changes, 'opportunity', isNew)) {
      return;
    }

    // A picked booth (see handlePickFromFloorPlan) only actually locks once
    // this save genuinely succeeds — sent along with the record itself so
    // the backend can commit it in the same transaction. Real-world testing
    // found that locking it immediately on pick, before the opportunity was
    // ever saved, orphaned the booth if the form was abandoned.
    const boothPayload = pickedBooth ? { floor_plan_booth_id: pickedBooth.id, exhibitor_name: exhibitorName } : {};

    setSaving(true);
    try {
      if (isNew) {
        const { opportunity } = await api.createOpportunity({ ...form, ...boothPayload });
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
        await api.updateOpportunity(id, { ...form, ...boothPayload });
        await billingRef.current?.save(id);
        if (movingToLost) {
          await api.updateExhibitor(form.exhibitor_id, { salesperson_id: null });
        }
        navigate('/opportunities');
      }
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  // Hands off to the Floor Plan screen's booth picker (see FloorPlan.jsx's
  // pickFor handling) — it navigates back here with the chosen booth in
  // router state, picked up by the effects above. For a brand-new,
  // not-yet-saved opportunity, the in-progress form has to travel along too
  // since navigating away unmounts this page and would otherwise lose it.
  function handlePickFromFloorPlan() {
    if (!form.exhibitor_id) {
      setError('Please select an exhibitor before picking a booth.');
      return;
    }
    navigate('/floor-plan', {
      state: {
        pickFor: {
          returnPath: isNew ? '/opportunities/new' : `/opportunities/${id}`,
          exhibitorName,
          boothStatus: 'RESERVED',
          formSnapshot: isNew ? { form, exhibitorName } : undefined,
        },
      },
    });
  }

  // Contracts are only ever created by transferring an approved opportunity
  // — this carries the quoted line items across so Sales doesn't have to
  // re-enter them, then lands on the new Contract to review before saving.
  async function handleGenerateContract() {
    if (!window.confirm('Create a Contract from this opportunity? You can review and edit it further afterward.')) return;
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
    }
  }

  if (loading) return <p style={{ maxWidth: 1100, margin: '40px auto' }}>Loading...</p>;

  return (
    <div className="page" style={{ maxWidth: 1100, margin: '40px auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>{isNew ? 'Add Opportunity' : editing ? 'Edit Opportunity' : 'Opportunity'}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {!isNew && !editing && !isViewOnly(user) && <button type="button" onClick={() => setEditing(true)}>Edit</button>}
          <button type="button" onClick={() => navigate('/opportunities')}>Back to list</button>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
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
              onChange={(e) => { set('booking_type', e.target.value); billingRef.current?.repriceAll(undefined, e.target.value); }}
            >
              <option value="">— Select —</option>
              <option value="PUBLISHED RATE">Published Rate</option>
              <option value="EARLY BIRD">Early Bird</option>
              <option value="ONSITE REBOOKING">Onsite Rebooking</option>
              <option value="CONTRA">Contra</option>
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
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={label}>Hall (optional)</label>
            <input style={inputStyle} value={form.hall} onChange={(e) => set('hall', e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={label}>Booth No (optional)</label>
            <input style={inputStyle} value={form.booth_no} onChange={(e) => set('booth_no', e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={label}>Dimension (optional)</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input style={inputStyle} placeholder="e.g. 3m x 3m" value={form.dimension} onChange={(e) => set('dimension', e.target.value)} />
              <button type="button" onClick={handlePickFromFloorPlan} title="Pick a booth from the Floor Plan" style={{ whiteSpace: 'nowrap' }}>
                📍 Pick
              </button>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 20 }}>
          <h3 style={{ marginBottom: 4 }}>Billing (estimate)</h3>
          <p style={{ fontSize: 13, color: '#5c6070' }}>
            Bare Space is the base item for a booth order — pick one upgrade at most, then add whichever
            services apply. Leave Bare Space unchecked for a non-booth order (badges/sponsorship only).
            This is saved together with the details above, and carries across to the Contract when you
            click "Generate Contract".
          </p>
          <BillingTemplate
            ref={billingRef}
            parentType="opportunity"
            parentId={id}
            currency={form.currency}
            bookingType={form.booking_type}
            items={items}
            priceList={priceList}
            taxCodes={taxCodes}
            onSaved={loadItems}
            showSaveButton={false}
          />
        </div>

        <label style={label}>Next Follow-up Date</label>
        <input type="date" style={inputStyle} value={form.next_follow_up_date} onChange={(e) => set('next_follow_up_date', e.target.value)} />

        <label style={label}>Remarks</label>
        <textarea style={{ ...inputStyle, minHeight: 48 }} value={form.remarks} onChange={(e) => set('remarks', e.target.value)} />
        </fieldset>

        {error && <p style={{ color: 'red' }}>{error}</p>}
        {editing && !isNew && <ChangesBanner changes={changes} />}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          {editing && (
            <button type="submit" disabled={saving} style={{ padding: '8px 16px' }}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          )}
          {!isNew && !isViewOnly(user) && (
            <button type="button" disabled={transferring} onClick={handleGenerateContract} style={{ padding: '8px 16px' }}>
              {transferring ? 'Creating...' : 'Generate Contract'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
