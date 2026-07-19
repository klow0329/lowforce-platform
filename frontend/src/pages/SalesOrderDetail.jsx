import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useEventContext } from '../context/EventContext';
import { computeChanges, confirmSave, ChangesBanner, fieldsetStyle } from '../utils/recordForm';
import BillingTemplate, { TEMPLATE_CODES } from '../components/BillingTemplate';

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

const emptyItemForm = {
  price_list_id: '', sales_item_code: '', description: '', category: 'OTHER',
  qty: 1, unit_price: '', discount_type: '', discount_value: '', tax_code_id: '',
};

export default function SalesOrderDetail({ user }) {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { events, selectedEventId } = useEventContext();
  const isElevated = ['ADM', 'MGT'].includes(user?.role_code);

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
  const [exhibitorName, setExhibitorName] = useState(lockedExhibitorName);
  const [exhibitorSearch, setExhibitorSearch] = useState('');
  const [exhibitorResults, setExhibitorResults] = useState([]);
  const [salespeople, setSalespeople] = useState([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [original, setOriginal] = useState(null);
  const [editing, setEditing] = useState(isNew);

  const [items, setItems] = useState([]);
  const [priceList, setPriceList] = useState([]);
  const [taxCodes, setTaxCodes] = useState([]);
  const [itemForm, setItemForm] = useState(emptyItemForm);
  const [showItemForm, setShowItemForm] = useState(false);
  const [editingItemId, setEditingItemId] = useState(null);

  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);

  const [invoices, setInvoices] = useState([]);
  const [showSplitForm, setShowSplitForm] = useState(false);
  const [splitMode, setSplitMode] = useState('FULL'); // FULL | MILESTONE
  const [milestoneSplits, setMilestoneSplits] = useState([{ pct: 50 }, { pct: 50 }]);
  const [generating, setGenerating] = useState(false);

  const [approvalLog, setApprovalLog] = useState([]);
  const [showLog, setShowLog] = useState(false);

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
  function loadSalesOrder() {
    api.getSalesOrder(id).then(({ salesOrder }) => {
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
      setForm(loaded);
      setOriginal(loaded);
      setSalesOrder(salesOrder);
      setExhibitorName(salesOrder.company_name);
      setLoading(false);
    });
  }

  useEffect(() => {
    api.listSalespeople().then(({ salespeople }) => setSalespeople(salespeople));
    api.listTaxCodes().then(({ taxCodes }) => setTaxCodes(taxCodes));
  }, []);

  useEffect(() => {
    if (isNew) return;
    loadSalesOrder();
    loadItems();
    loadAttachments();
    loadInvoices();
    loadApprovalLog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isNew]);

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
    setSaving(true);
    try {
      if (isNew) {
        const { salesOrder } = await api.createSalesOrder(form);
        navigate(`/sales-orders/${salesOrder.id}`);
      } else {
        await api.updateSalesOrder(id, form);
        navigate('/sales-orders');
      }
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  // --- Line items --------------------------------------------------------

  function pickPriceListItem(plId) {
    const pl = priceList.find((p) => p.id === plId);
    if (!pl) {
      setItemForm((f) => ({ ...f, price_list_id: '' }));
      return;
    }
    const unitPrice = form.currency === 'USD' ? pl.unit_price_usd : pl.unit_price_myr;
    setItemForm((f) => ({
      ...f,
      price_list_id: pl.id,
      sales_item_code: pl.sales_item_code,
      description: pl.description || '',
      category: pl.category,
      unit_price: unitPrice ?? '',
      tax_code_id: pl.default_tax_code_id || '',
    }));
  }

  function startAddItem() {
    setItemForm(emptyItemForm);
    setEditingItemId(null);
    setShowItemForm(true);
  }

  function startEditItem(it) {
    setItemForm({
      price_list_id: it.price_list_id || '',
      sales_item_code: it.sales_item_code,
      description: it.description || '',
      category: it.category,
      qty: it.qty,
      unit_price: it.unit_price,
      discount_type: it.discount_type || '',
      discount_value: it.discount_value ?? '',
      tax_code_id: it.tax_code_id || '',
    });
    setEditingItemId(it.id);
    setShowItemForm(true);
  }

  async function handleSaveItem(e) {
    e.preventDefault();
    setError('');
    const payload = { ...itemForm, price_list_id: itemForm.price_list_id || null, tax_code_id: itemForm.tax_code_id || null };
    try {
      if (editingItemId) {
        await api.updateSalesOrderItem(id, editingItemId, payload);
      } else {
        await api.addSalesOrderItem(id, payload);
      }
      setShowItemForm(false);
      setItemForm(emptyItemForm);
      setEditingItemId(null);
      loadItems();
      loadSalesOrder();
      loadApprovalLog();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteItem(it) {
    if (!window.confirm(`Remove ${it.sales_item_code} from this contract?`)) return;
    setError('');
    try {
      await api.deleteSalesOrderItem(id, it.id);
      loadItems();
      loadSalesOrder();
    } catch (err) {
      setError(err.message);
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

  // --- Draft invoices --------------------------------------------------------

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
    if (!window.confirm(splits ? `Generate ${splits.length} milestone draft invoices?` : 'Generate a draft invoice for the full remaining balance?')) return;
    setGenerating(true);
    try {
      await api.generateDraftInvoices({ sales_order_id: id, splits });
      setShowSplitForm(false);
      loadInvoices();
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  // --- Approvals ---------------------------------------------------------

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

  if (loading) return <p style={{ maxWidth: 700, margin: '40px auto' }}>Loading...</p>;

  const ccy = form.currency;
  const totalInvoiced = invoices.reduce((sum, inv) => sum + Number(inv.amount_foreign), 0);
  const contractTotal = Number(salesOrder?.total_foreign || 0);
  const remaining = contractTotal - totalInvoiced;

  return (
    <div className="page" style={{ maxWidth: 700, margin: '40px auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {isNew ? 'New Contract' : editing ? 'Edit Contract' : 'Contract'}
          {!isNew && salesOrder && <StatusBadge status={salesOrder.status} />}
        </h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {!isNew && !editing && <button type="button" onClick={() => setEditing(true)}>Edit</button>}
          <button type="button" onClick={() => navigate('/sales-orders')}>Back to list</button>
        </div>
      </div>

      {!isNew && salesOrder?.status === 'PENDING_APPROVAL' && isElevated && (
        <div style={{ background: '#FFF3BF', border: '1px solid #F0C36D', borderRadius: 8, padding: 12, margin: '12px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>This contract is pending approval.</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={handleApprove}>Approve</button>
            <button type="button" onClick={handleReject}>Reject</button>
          </div>
        </div>
      )}
      {!isNew && salesOrder?.status === 'PENDING_APPROVAL' && !isElevated && (
        <div style={{ background: '#FFF3BF', border: '1px solid #F0C36D', borderRadius: 8, padding: 12, margin: '12px 0' }}>
          Waiting on Admin/Management approval.
        </div>
      )}

      <form onSubmit={handleSubmit}>
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
        <select style={inputStyle} value={form.currency} onChange={(e) => set('currency', e.target.value)} disabled={!isNew && items.length > 0}>
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
        <select style={inputStyle} value={form.booking_type} onChange={(e) => set('booking_type', e.target.value)}>
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
            <input style={inputStyle} placeholder="e.g. 3m x 3m" value={form.dimension} onChange={(e) => set('dimension', e.target.value)} />
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
              <button type="button" onClick={() => navigate(`/sales-orders/${id}/print`)} style={{ padding: '8px 16px' }}>
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
            salesOrderId={id}
            currency={ccy}
            bookingType={form.booking_type}
            items={items}
            priceList={priceList}
            taxCodes={taxCodes}
            onSaved={() => { loadItems(); loadSalesOrder(); loadApprovalLog(); }}
          />
        </div>
      )}

      {!isNew && (
        <div style={{ marginTop: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3>Additional Items</h3>
            <button type="button" onClick={startAddItem}>+ Add Other Item</button>
          </div>

          {showItemForm && (
            <form onSubmit={handleSaveItem} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, margin: '12px 0' }}>
              <label style={label}>From Price List (optional — autofills the fields below)</label>
              <select style={inputStyle} value={itemForm.price_list_id} onChange={(e) => pickPriceListItem(e.target.value)}>
                <option value="">— Manual entry —</option>
                {priceList
                  .filter((p) => !form.booking_type || p.booth_type === form.booking_type)
                  .map((p) => (
                    <option key={p.id} value={p.id}>{p.booth_type} · {p.sales_item_code} — {fmt(ccy === 'USD' ? p.unit_price_usd : p.unit_price_myr, ccy)}</option>
                  ))}
              </select>

              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={label}>Item Code</label>
                  <input style={inputStyle} value={itemForm.sales_item_code} onChange={(e) => setItemForm({ ...itemForm, sales_item_code: e.target.value })} required />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={label}>Category</label>
                  <select style={inputStyle} value={itemForm.category} onChange={(e) => setItemForm({ ...itemForm, category: e.target.value })}>
                    <option value="BOOTH">Booth</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
              </div>

              <label style={label}>Description (free text — e.g. custom CUB items)</label>
              <input style={inputStyle} value={itemForm.description} onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })} />

              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={label}>Qty</label>
                  <input type="number" step="0.01" style={inputStyle} value={itemForm.qty} onChange={(e) => setItemForm({ ...itemForm, qty: e.target.value })} required />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={label}>Unit Price ({ccy})</label>
                  <input type="number" step="0.01" style={inputStyle} value={itemForm.unit_price} onChange={(e) => setItemForm({ ...itemForm, unit_price: e.target.value })} required />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={label}>Discount</label>
                  <select style={inputStyle} value={itemForm.discount_type} onChange={(e) => setItemForm({ ...itemForm, discount_type: e.target.value })}>
                    <option value="">— None —</option>
                    <option value="FLAT">Flat amount ({ccy})</option>
                    <option value="PERCENT">Percentage (%)</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={label}>Discount Value</label>
                  <input type="number" step="0.01" style={inputStyle} value={itemForm.discount_value} onChange={(e) => setItemForm({ ...itemForm, discount_value: e.target.value })} disabled={!itemForm.discount_type} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={label}>Tax Code</label>
                  <select style={inputStyle} value={itemForm.tax_code_id} onChange={(e) => setItemForm({ ...itemForm, tax_code_id: e.target.value })}>
                    <option value="">— None —</option>
                    {taxCodes.map((tc) => (
                      <option key={tc.id} value={tc.id}>{tc.code} ({tc.rate_pct}%)</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button type="submit">{editingItemId ? 'Save Item' : 'Add Item'}</button>
                <button type="button" onClick={() => { setShowItemForm(false); setEditingItemId(null); }}>Cancel</button>
              </div>
            </form>
          )}

          <table width="100%" cellPadding="6" className="responsive">
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                <th>Code</th><th>Description</th><th>Qty</th><th style={{ textAlign: 'right' }}>Unit Price</th>
                <th style={{ textAlign: 'right' }}>Discount</th><th>Tax</th><th style={{ textAlign: 'right' }}>Line Total</th><th></th>
              </tr>
            </thead>
            <tbody>
              {items.filter((it) => !TEMPLATE_CODES.includes(it.sales_item_code)).map((it) => (
                <tr key={it.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td data-label="Code">{it.sales_item_code}</td>
                  <td data-label="Description">{it.description || '—'}</td>
                  <td data-label="Qty">{it.qty}</td>
                  <td data-label="Unit Price" style={{ textAlign: 'right' }}>{fmt(it.unit_price, ccy)}</td>
                  <td data-label="Discount" style={{ textAlign: 'right' }}>{Number(it.discount_amount) > 0 ? fmt(it.discount_amount, ccy) : '—'}</td>
                  <td data-label="Tax">{it.tax_code || '—'}</td>
                  <td data-label="Line Total" style={{ textAlign: 'right' }}>{fmt(it.line_total, ccy)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button type="button" onClick={() => startEditItem(it)}>Edit</button>{' '}
                    <button type="button" onClick={() => handleDeleteItem(it)}>Delete</button>
                  </td>
                </tr>
              ))}
              {items.filter((it) => !TEMPLATE_CODES.includes(it.sales_item_code)).length === 0 && (
                <tr><td colSpan={8}>No additional items.</td></tr>
              )}
            </tbody>
          </table>

          <div style={{ textAlign: 'right', marginTop: 12, fontWeight: 600 }}>
            Contract Total ({ccy}): {fmt(salesOrder?.total_foreign, ccy)}
            {ccy === 'USD' && (
              <div style={{ fontWeight: 400, fontSize: 13, color: '#5c6070' }}>
                ≈ {fmt(salesOrder?.total_myr, 'MYR')} (estimate rate)
              </div>
            )}
          </div>
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
              {remaining > 0.01 && contractTotal > 0 && (
                <button type="button" onClick={() => setShowSplitForm(!showSplitForm)}>
                  {showSplitForm ? 'Cancel' : 'Generate Draft Invoice(s)'}
                </button>
              )}
            </div>

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
                    {generating ? 'Generating...' : 'Generate'}
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
