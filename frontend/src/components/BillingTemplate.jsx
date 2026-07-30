import { useEffect, useState, useMemo, forwardRef, useImperativeHandle } from 'react';
import { api } from '../api/client';

// The standard MIFB booth-order billing template: Bare Space is the base
// item, the exhibitor can add one or more upgrade rows (Shell Scheme/
// Enhanced Shell/Walk-On/Custom Build, or any admin-added tier) — one per
// distinct tier, since some exhibitors mix upgrade options across their
// booths in the same contract — then Corner/Loading/MEP/Badge/Sponsorship/
// Other are independent optional add-ons. Sponsorship and Other get a wide
// free-text row since they carry open-ended agreement details; keeping them
// adjacent at the bottom of the sheet is what the reference layout expects.
// These 4 base sets seed the sheet for a brand-new event before any Price
// List item has been marked up (and are what Budget.jsx's static dropdown
// still uses, since it has no live per-event Price List context of its
// own). Within an actual BillingTemplate instance, the *effective* Upgrade/
// addon code lists are computed below (upgradeCodes/addonCodes) as this
// base set UNIONed with whatever the current event's Price List has marked
// is_upgrade_option/is_addon_item/is_wide_row — so a company can add its
// own new Upgrade tier, LOD-alike addon, or free-text "agreement value"
// item (like Sponsorship/Other) purely from the Price List admin screen,
// no code change needed. SPO/OTH are just the seeded defaults.
export const UPGRADE_CODES = ['SSS', 'ESS', 'WOP', 'CUB'];
const NARROW_ROW_CODES = ['COR', 'LOD', 'MEP', 'BAD'];
const WIDE_ROW_CODES = ['SPO', 'OTH'];
const FIXED_ROW_CODES = [...NARROW_ROW_CODES, ...WIDE_ROW_CODES];
export const TEMPLATE_CODES = ['BAS', ...UPGRADE_CODES, ...FIXED_ROW_CODES];

export const FIXED_LABELS = {
  BAS: 'BARE SPACE', COR: 'CORNER CHARGE', LOD: 'LOADING', MEP: 'MARKETING EXPOSURE PACKAGE',
  BAD: 'BADGE', SPO: 'SPONSORSHIP', OTH: 'OTHER',
  SSS: 'SHELL SCHEME', ESS: 'ENHANCED SHELL', WOP: 'WALK ON PACKAGE', CUB: 'CUSTOM BUILD',
};

// Sized generously — this table used to live in a 700px page column, which
// truncated every value; the detail pages are wide enough now that these
// just need to comfortably fit real data (four-figure rates, "8.00% (SV-8)").
const smallInput = { width: '100%', padding: 6, boxSizing: 'border-box', fontSize: 13 };
const COL = { checkbox: 30, code: 80, qty: 70, rate: 110, discount: 190, tax: 140, total: 110 };

const ENDPOINTS = {
  contract: {
    add: api.addSalesOrderItem, update: api.updateSalesOrderItem, remove: api.deleteSalesOrderItem,
  },
  opportunity: {
    add: api.addOpportunityItem, update: api.updateOpportunityItem, remove: api.deleteOpportunityItem,
  },
};

function findPriceListEntry(priceList, code, bookingType) {
  if (!code) return null;
  return (
    priceList.find((p) => p.sales_item_code === code && p.booth_type === bookingType) ||
    priceList.find((p) => p.sales_item_code === code && p.booth_type === 'ALL TIERS') ||
    priceList.find((p) => p.sales_item_code === code)
  );
}

// Live preview shown whenever a row isn't checked yet — computed fresh from
// the Price List every render rather than stored, so it always tracks the
// current Tier/Currency without needing its own sync effect. FIXED_LABELS
// takes priority over the Price List's own description so the sheet always
// shows the short standard names, regardless of what's typed into the Price
// List admin screen. LOD's rate is bas-Sqm-rate * a %, same generic formula
// as any other admin-configured "% of Bare Space" Price List item (Pricing
// Mode = "% of Bare Space", see the Price List item editor) — that Price
// List row is authoritative once an admin has set it up there; lodPct (the
// legacy Admin > Company Profile field) is only a fallback for a company
// that hasn't configured the Price List's own LOD row yet, so nothing goes
// to RM0 out from under an existing setup.
function computeDefaults(code, priceList, currency, bookingType, basUnitPrice, lodPct = 15) {
  if (!code) return { description: '', unit_price: '', tax_code_id: '', category: undefined };
  const pl = findPriceListEntry(priceList, code, bookingType);
  let unit_price = pl ? ((currency === 'USD' ? pl.unit_price_usd : pl.unit_price_myr) ?? '') : '';
  if (code === 'LOD' || pl?.pricing_mode === 'PCT_OF_BAS') {
    // Price list values arrive as NUMERIC strings from Postgres (already
    // fixed to 2dp, e.g. "1350.00") — match that formatting here too,
    // otherwise a clean split (e.g. 202.5) shows one decimal short.
    const bas = Number(basUnitPrice) || 0;
    const pct = pl?.pricing_mode === 'PCT_OF_BAS' ? (Number(pl.pricing_pct) || 0) : (Number(lodPct) || 0);
    unit_price = bas > 0 ? (Math.round(bas * pct / 100 * 100) / 100).toFixed(2) : '';
  }
  return {
    description: (FIXED_LABELS[code] || pl?.description || code).toUpperCase(),
    unit_price,
    tax_code_id: pl?.default_tax_code_id || '',
    category: pl?.category,
  };
}

function blankRow(code) {
  return { id: null, code, description: '', qty: '', unit_price: '', discount_value: '', tax_code_id: '', included: false, userEdited: false };
}

// Upgrade rows are keyed independently of `id` (which stays null until
// saved, so two brand-new rows would otherwise collide) — a simple counter
// is enough since this only ever needs to be unique within one mounted
// BillingTemplate instance.
let nextUpgradeRowKey = 0;
function blankUpgradeRow(code = '') {
  return { rowKey: `new-${nextUpgradeRowKey++}`, ...blankRow(code) };
}

function rowFromItem(it) {
  return {
    id: it.id, code: it.sales_item_code,
    description: it.description || '', qty: it.qty, unit_price: it.unit_price,
    discount_value: it.discount_value ?? '', tax_code_id: it.tax_code_id || '',
    included: true, userEdited: false,
  };
}

function subtotalOf(row) {
  return (Number(row.qty) || 0) * (Number(row.unit_price) || 0);
}

function calcLineTotal(row, taxCodes) {
  const subtotal = subtotalOf(row);
  const discountAmount = subtotal * (Number(row.discount_value) || 0) / 100;
  const taxable = subtotal - discountAmount;
  const taxCode = taxCodes.find((t) => t.id === row.tax_code_id);
  const taxAmount = taxable * (taxCode ? Number(taxCode.rate_pct) : 0) / 100;
  return taxable + taxAmount;
}

// --- Shared row pieces — module-level, NOT nested inside BillingTemplate.
// Defining row components inside the parent's render body gives them a new
// function identity on every keystroke, which makes React unmount/remount
// the underlying <input> each time and drop focus after one character.
// Keeping them here (mounted once, driven purely by props) is what makes
// typing actually work. ---------------------------------------------------

function DiscountCell({ row, onField }) {
  const subtotal = subtotalOf(row);
  const pct = row.discount_value === '' || row.discount_value === undefined || row.discount_value === null ? '' : Number(row.discount_value);
  const amt = pct === '' ? '' : Math.round(subtotal * (Number(pct) || 0) / 100 * 100) / 100;
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      <div style={{ position: 'relative', flex: 1 }}>
        <input
          type="number" step="0.01" style={{ ...smallInput, paddingRight: 18 }} placeholder="%" title="Discount %"
          value={pct} disabled={!row.included}
          onChange={(e) => onField('discount_value', e.target.value)}
        />
        {pct !== '' && (
          <span style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: '#5c6070', pointerEvents: 'none' }}>%</span>
        )}
      </div>
      <input
        type="number" step="0.01" style={{ ...smallInput, flex: 1 }} placeholder="Amt" title="Discount amount"
        value={amt} disabled={!row.included}
        onChange={(e) => {
          const newAmt = Number(e.target.value) || 0;
          onField('discount_value', subtotal > 0 ? (newAmt / subtotal) * 100 : 0);
        }}
      />
    </div>
  );
}

function TaxSelect({ taxCodeId, included, taxCodes, onField }) {
  return (
    <select style={smallInput} value={taxCodeId} disabled={!included} onChange={(e) => onField('tax_code_id', e.target.value)}>
      <option value="">—</option>
      {taxCodes.map((tc) => <option key={tc.id} value={tc.id}>{tc.rate_pct}% ({tc.code})</option>)}
    </select>
  );
}

function fmtTotal(n) {
  return Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function NarrowRow({ code, checked, onToggle, row, onField, priceList, currency, bookingType, taxCodes, basUnitPrice, lodPct }) {
  const display = row.included ? row : { ...row, ...computeDefaults(code, priceList, currency, bookingType, basUnitPrice, lodPct) };
  const total = row.included ? calcLineTotal(row, taxCodes) : 0;
  return (
    <tr style={{ borderBottom: '1px solid #eee' }}>
      <td style={{ width: COL.checkbox }}><input type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} /></td>
      <td style={{ width: COL.code, fontWeight: 600 }}>{code}</td>
      <td>
        <input style={smallInput} value={display.description} disabled={!row.included} onChange={(e) => onField('description', e.target.value.toUpperCase())} />
      </td>
      <td style={{ width: COL.qty }}>
        <input type="number" step="0.01" style={smallInput} value={row.included ? row.qty : ''} disabled={!row.included} onChange={(e) => onField('qty', e.target.value)} />
      </td>
      <td style={{ width: COL.rate }}>
        <input
          type="number" step="0.01" style={{ ...smallInput, background: '#F5F6FA' }} value={display.unit_price}
          disabled title="Locked to the Price List rate — use Discount to adjust" readOnly
        />
      </td>
      <td style={{ width: COL.discount }}><DiscountCell row={row} onField={onField} /></td>
      <td style={{ width: COL.tax }}><TaxSelect taxCodeId={display.tax_code_id} included={row.included} taxCodes={taxCodes} onField={onField} /></td>
      <td style={{ width: COL.total, textAlign: 'right', fontWeight: 600 }}>{row.included ? fmtTotal(total) : '—'}</td>
    </tr>
  );
}

function UpgradeRow({ upgrade, onSelectUpgrade, onField, onRemove, canRemove, priceList, currency, bookingType, taxCodes, availableCodes }) {
  const display = upgrade.included ? upgrade : { ...upgrade, ...computeDefaults(upgrade.code, priceList, currency, bookingType) };
  const total = upgrade.included ? calcLineTotal(upgrade, taxCodes) : 0;
  return (
    <tr style={{ borderBottom: '1px solid #eee' }}>
      <td>
        {canRemove && (
          <button type="button" onClick={onRemove} title="Remove this upgrade row" style={{ padding: '2px 6px', fontSize: 12, lineHeight: 1 }}>×</button>
        )}
      </td>
      <td style={{ width: COL.code }}>
        <select style={smallInput} value={upgrade.code} onChange={(e) => onSelectUpgrade(e.target.value)}>
          <option value="">— None —</option>
          {availableCodes.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </td>
      <td>
        <input style={smallInput} value={display.description} disabled={!upgrade.included} onChange={(e) => onField('description', e.target.value.toUpperCase())} />
      </td>
      <td style={{ width: COL.qty }}>
        <input type="number" step="0.01" style={smallInput} value={upgrade.included ? upgrade.qty : ''} disabled={!upgrade.included} onChange={(e) => onField('qty', e.target.value)} />
      </td>
      <td style={{ width: COL.rate }}>
        <input
          type="number" step="0.01" style={{ ...smallInput, background: '#F5F6FA' }} value={display.unit_price}
          disabled title="Locked to the Price List rate — use Discount to adjust" readOnly
        />
      </td>
      <td style={{ width: COL.discount }}><DiscountCell row={upgrade} onField={onField} /></td>
      <td style={{ width: COL.tax }}><TaxSelect taxCodeId={display.tax_code_id} included={upgrade.included} taxCodes={taxCodes} onField={onField} /></td>
      <td style={{ width: COL.total, textAlign: 'right', fontWeight: 600 }}>{upgrade.included ? fmtTotal(total) : '—'}</td>
    </tr>
  );
}

function WideRow({ code, checked, onToggle, row, onField, priceList, currency, bookingType, taxCodes }) {
  const display = row.included ? row : { ...row, ...computeDefaults(code, priceList, currency, bookingType) };
  const total = row.included ? calcLineTotal(row, taxCodes) : 0;
  return (
    <>
      <tr style={{ borderTop: '1px solid #ddd' }}>
        <td style={{ width: COL.checkbox, verticalAlign: 'top', paddingTop: 8 }}><input type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} /></td>
        <td style={{ width: COL.code, fontWeight: 600, verticalAlign: 'top', paddingTop: 8 }}>{code}</td>
        <td colSpan={5}>
          <textarea
            style={{ ...smallInput, minHeight: 56, resize: 'vertical' }}
            value={display.description} disabled={!row.included}
            onChange={(e) => onField('description', e.target.value.toUpperCase())}
          />
        </td>
        <td style={{ width: COL.total, textAlign: 'right', fontWeight: 600, verticalAlign: 'top', paddingTop: 8 }}>{row.included ? fmtTotal(total) : '—'}</td>
      </tr>
      <tr style={{ borderBottom: '1px solid #eee' }}>
        <td></td><td></td>
        <td style={{ fontSize: 11, color: '#5c6070', textAlign: 'right', paddingRight: 6 }}>Qty / Rate / Disc / Tax →</td>
        <td style={{ width: COL.qty }}>
          <input type="number" step="0.01" style={smallInput} value={row.included ? row.qty : ''} disabled={!row.included} onChange={(e) => onField('qty', e.target.value)} />
        </td>
        <td style={{ width: COL.rate }}>
          <input type="number" step="0.01" style={smallInput} value={display.unit_price} disabled={!row.included} onChange={(e) => onField('unit_price', e.target.value)} />
        </td>
        <td style={{ width: COL.discount }}><DiscountCell row={row} onField={onField} /></td>
        <td style={{ width: COL.tax }}><TaxSelect taxCodeId={display.tax_code_id} included={row.included} taxCodes={taxCodes} onField={onField} /></td>
        <td></td>
      </tr>
    </>
  );
}

// showSaveButton=false lets a parent form (e.g. a "create record + billing
// in one Save" page) drive saving itself: it calls ref.current.save(id) with
// the parent record's id once that id exists (which, for a brand-new record,
// only happens after the parent's own create call returns) instead of this
// component making its own API calls on its own button.
const BillingTemplate = forwardRef(function BillingTemplate(
  { parentType, parentId, currency, bookingType, items, priceList, taxCodes, onSaved, showSaveButton = true, readOnly = false, rightActions, onTotalChange, lodPct = 15 }, ref
) {
  const { add: apiAdd, update: apiUpdate, remove: apiRemove } = ENDPOINTS[parentType];

  // The base hardcoded sets, UNIONed with anything the current event's
  // Price List has admin-marked is_upgrade_option/is_addon_item — a new
  // company (or a new item on an existing one) can add its own Upgrade
  // tier or LOD-alike addon purely from the Price List screen (see
  // PriceList.jsx), no code change needed.
  const upgradeCodes = useMemo(() => {
    const codes = [...UPGRADE_CODES];
    for (const p of priceList) if (p.is_upgrade_option && !codes.includes(p.sales_item_code)) codes.push(p.sales_item_code);
    return codes;
  }, [priceList]);
  const addonCodes = useMemo(() => {
    const codes = [...NARROW_ROW_CODES];
    for (const p of priceList) if (p.is_addon_item && !codes.includes(p.sales_item_code)) codes.push(p.sales_item_code);
    return codes;
  }, [priceList]);
  const wideRowCodes = useMemo(() => {
    const codes = [...WIDE_ROW_CODES];
    for (const p of priceList) if (p.is_wide_row && !codes.includes(p.sales_item_code)) codes.push(p.sales_item_code);
    return codes;
  }, [priceList]);

  const [bas, setBas] = useState(blankRow('BAS'));
  // An exhibitor can mix several upgrade tiers in one contract (e.g. one
  // booth on Enhanced Shell, another on Walk On Package) — so this is a list
  // of independently addable rows, not one exclusive dropdown+row. Starts
  // with a single blank row so the sheet still looks like a normal optional
  // line until Sales actually picks something.
  const [upgradeRows, setUpgradeRows] = useState(() => [blankUpgradeRow()]);
  const [fixedRows, setFixedRows] = useState(() => Object.fromEntries(FIXED_ROW_CODES.map((c) => [c, blankRow(c)])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // addonCodes can grow once the Price List finishes loading (it starts
  // empty on first render) — top up fixedRows with blank entries for any
  // newly-discovered code without touching rows already in progress.
  useEffect(() => {
    setFixedRows((rows) => {
      const next = { ...rows };
      let changed = false;
      for (const c of [...addonCodes, ...wideRowCodes]) {
        if (!(c in next)) { next[c] = blankRow(c); changed = true; }
      }
      return changed ? next : rows;
    });
  }, [addonCodes, wideRowCodes]);

  useEffect(() => {
    const byCode = {};
    const allKnownCodes = ['BAS', ...upgradeCodes, ...addonCodes, ...wideRowCodes];
    for (const it of items) {
      if (allKnownCodes.includes(it.sales_item_code)) byCode[it.sales_item_code] = it;
    }

    setBas(byCode.BAS ? rowFromItem(byCode.BAS) : blankRow('BAS'));

    const upgradeItems = upgradeCodes.map((c) => byCode[c]).filter(Boolean);
    setUpgradeRows(upgradeItems.length > 0
      ? upgradeItems.map((it) => ({ rowKey: `saved-${it.id}`, ...rowFromItem(it) }))
      : [blankUpgradeRow()]);

    setFixedRows(Object.fromEntries([...addonCodes, ...wideRowCodes].map((c) => [c, byCode[c] ? rowFromItem(byCode[c]) : blankRow(c)])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // BAS's current rate — whatever's shown for it right now, whether it's
  // been checked and possibly edited, or is still just the Price List
  // preview. LOD's rate formula (15% of Bare Space) always reads off this.
  function currentBasRate() {
    if (bas.included) return Number(bas.unit_price) || 0;
    return Number(computeDefaults('BAS', priceList, currency, bookingType).unit_price) || 0;
  }

  function applyDefaults(row, code) {
    const d = computeDefaults(code, priceList, currency, bookingType, currentBasRate(), lodPct);
    return { ...row, code, description: d.description, unit_price: d.unit_price, tax_code_id: d.tax_code_id, category: d.category, included: true, qty: row.qty || 1 };
  }

  function toggleBas(checked) {
    setBas((r) => (checked ? { ...applyDefaults(r, 'BAS'), userEdited: true } : { ...r, included: false, qty: '', userEdited: true }));
  }

  // Typing directly into Qty/Rate marks the row as manually controlled —
  // applyBoothAllocation then leaves it alone on any later booth pick/unpick,
  // instead of silently stomping what the user just set (real case: only 36
  // of 90 sqm physically picked so far, but billing should still reflect the
  // full 90 until Sales says otherwise).
  function setBasField(field, value) {
    setBas((r) => ({ ...r, [field]: value, userEdited: r.userEdited || field === 'qty' || field === 'unit_price' }));
  }

  // Switching a row's upgrade dropdown re-uses the same underlying line item
  // (update its code in place) rather than deleting and re-adding. Qty
  // defaults to BAS's own qty (the booth's sqm) when one's already
  // allocated — an upgrade is priced per sqm same as Bare Space, it's just a
  // different build tier, not a different size. Rows are otherwise
  // independent, so an exhibitor can carry several upgrade tiers at once.
  function selectUpgradeRow(rowKey, code) {
    setUpgradeRows((rows) => rows.map((r) => {
      if (r.rowKey !== rowKey) return r;
      if (!code) return { ...r, code: '', included: false, qty: '' };
      if (r.code === code) return r;
      const row = applyDefaults({ ...blankRow(code), id: r.id, rowKey: r.rowKey }, code);
      return bas.included ? { ...row, qty: bas.qty } : row;
    }));
  }

  function setUpgradeRowField(rowKey, field, value) {
    setUpgradeRows((rows) => rows.map((r) => (
      r.rowKey !== rowKey ? r : { ...r, [field]: value, userEdited: r.userEdited || field === 'qty' || field === 'unit_price' }
    )));
  }

  function addUpgradeRow() {
    setUpgradeRows((rows) => [...rows, blankUpgradeRow()]);
  }

  // Dropping back to zero rows would leave no way to add the first upgrade
  // back except this same button, which reads oddly once the whole section
  // is gone — always leave one blank row behind instead.
  function removeUpgradeRow(rowKey) {
    setUpgradeRows((rows) => {
      const next = rows.filter((r) => r.rowKey !== rowKey);
      return next.length > 0 ? next : [blankUpgradeRow()];
    });
  }

  function toggleFixed(code, checked) {
    setFixedRows((rows) => {
      const current = rows[code] || blankRow(code);
      return {
        ...rows,
        [code]: checked ? { ...applyDefaults(current, code), userEdited: true } : { ...current, included: false, qty: '', userEdited: true },
      };
    });
  }

  function setFixedField(code, field, value) {
    setFixedRows((rows) => {
      const current = rows[code] || blankRow(code);
      return {
        ...rows,
        [code]: { ...current, [field]: value, userEdited: current.userEdited || field === 'qty' || field === 'unit_price' },
      };
    });
  }

  const allRows = [bas, ...upgradeRows, ...Object.values(fixedRows)];
  const liveTotal = allRows.reduce((sum, row) => sum + (row.included ? calcLineTotal(row, taxCodes) : 0), 0);

  // Lets a parent track the running total reactively (e.g. the Credit Note
  // adjustment editor's live shortfall figure) without polling the
  // imperative handle on every keystroke.
  useEffect(() => {
    onTotalChange?.(liveTotal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveTotal]);

  // The actual sync-to-server logic, parameterized by the target parent id
  // rather than reading the parentId prop directly — a brand-new record has
  // no id until the parent's own create call returns one.
  async function doSave(targetParentId, editReason) {
    // An Upgrade tier's sqm has to fit within the space actually being sold
    // (Bare Space's own qty) — one upgrade covering more sqm than the
    // contract's total Bare Space would double-book floor space that was
    // never bought. Sum across every included upgrade row, since several
    // tiers can be mixed on one contract.
    if (bas.included) {
      const basSqm = Number(bas.qty) || 0;
      const upgradeSqm = upgradeRows.filter((r) => r.included && r.code).reduce((sum, r) => sum + (Number(r.qty) || 0), 0);
      if (upgradeSqm > basSqm + 0.01) {
        throw new Error(`Upgrade sqm (${upgradeSqm}) cannot exceed Bare Space's total sqm (${basSqm}). Adjust the upgrade qty/booth allocation.`);
      }
    }

    const ops = [];

    for (const row of allRows) {
      if (row.included && row.code) {
        const payload = {
          sales_item_code: row.code,
          description: row.description,
          category: row.category || (row.code === 'BAS' || upgradeCodes.includes(row.code) ? 'BOOTH' : 'OTHER'),
          // A row can be checked before the Price List has a rate for it
          // (e.g. no USD price set for an item) — never send '' to a
          // NOT NULL numeric column, default to 0 so Finance can fix it up.
          qty: Number(row.qty) || 0,
          unit_price: Number(row.unit_price) || 0,
          discount_type: row.discount_value ? 'PERCENT' : null,
          discount_value: row.discount_value || null,
          tax_code_id: row.tax_code_id || null,
          // Lets a specific caller (e.g. SalesOrderDetail's Save Booth
          // Change) override the generic "Contract edited after approval"
          // approval-log text with something that actually names what
          // changed — see checkPostApprovalEdit.
          edit_reason: editReason || undefined,
        };
        ops.push(row.id ? apiUpdate(targetParentId, row.id, payload) : apiAdd(targetParentId, payload));
      } else if (row.id) {
        ops.push(apiRemove(targetParentId, row.id));
      }
    }

    await Promise.all(ops);
  }

  // Populates the sheet from a Floor Plan booth pick. byType is the sqm sum
  // per booth-item code from whichever type each individual booth was
  // tagged as (see FloorPlan.jsx's per-booth type dropdown) — untagged
  // booths count as Bare Space. BAS's qty is byType.BAS; each upgrade tier's
  // qty is its own byType entry, so mixing tiers across booths in one
  // contract now actually splits the sqm instead of every checked row
  // getting the same aggregate total. LOD (15% of the bare space rate, same
  // per-sqm basis) is keyed off the TOTAL sqm across every type if the
  // booth is flagged loading; COR is a flat qty=1 per-unit charge if
  // flagged corner — both apply to the group as a whole regardless of which
  // specific type each booth is. Computed
  // directly via computeDefaults rather than the stateful applyDefaults/
  // currentBasRate helpers, since those read `bas` from the CURRENT render
  // — which is still the old value while this function is still running,
  // so LOD's 15%-of-BAS rate would otherwise be computed off a stale BAS.
  // Each row is only auto-populated here while it's still under the
  // system's control (userEdited === false) — the moment Sales types into
  // a row's Qty/Rate or manually (un)ticks it, it's theirs: re-picking
  // booths afterward (adding/removing on a later trip to the Floor Plan)
  // no longer touches that row, so a deliberate "bill for the full 90 sqm
  // even though only 36 is physically picked so far" doesn't get clobbered.
  function applyBoothAllocation({ byType, isCorner, isLoading }) {
    const bt = byType || {};
    const sqmNum = Object.values(bt).reduce((sum, v) => sum + (Number(v) || 0), 0);
    const basSqm = Number(bt.BAS) || 0;
    const basDefaults = computeDefaults('BAS', priceList, currency, bookingType);
    const newBas = bas.userEdited ? bas : {
      ...bas, code: 'BAS', description: basDefaults.description, unit_price: basDefaults.unit_price,
      tax_code_id: basDefaults.tax_code_id, category: basDefaults.category,
      included: basSqm > 0, qty: basSqm || '',
    };
    if (!bas.userEdited) setBas(newBas);

    // Each upgrade tier's qty is now the sum of whichever booths were tagged
    // that specific type on the Floor Plan (see FloorPlan.jsx's per-booth
    // type dropdown) — not the same aggregate sqm as Bare Space, since an
    // exhibitor can mix tiers across their booths in one contract. Only
    // touches rows Sales hasn't manually edited yet, same protection as the
    // rest of this function. A code present in byType with no matching row
    // yet gets one created; a row for a code no longer in byType (no booths
    // tagged that type anymore) gets cleared, not left stale.
    setUpgradeRows((rows) => {
      const next = [];
      const seenCodes = new Set();
      for (const r of rows) {
        if (r.userEdited) { next.push(r); continue; }
        if (r.code && r.code in bt) {
          seenCodes.add(r.code);
          const codeSqm = Number(bt[r.code]) || 0;
          next.push({ ...r, included: codeSqm > 0, qty: codeSqm || '' });
        } else if (!r.code) {
          next.push(r); // untouched blank row — may get reused below
        } else {
          next.push({ ...r, included: false, qty: '' });
        }
      }
      for (const code of Object.keys(bt)) {
        if (code === 'BAS' || seenCodes.has(code) || !(Number(bt[code]) > 0)) continue;
        const row = applyDefaults(blankUpgradeRow(code), code);
        row.qty = Number(bt[code]);
        const blankIdx = next.findIndex((r) => !r.code);
        if (blankIdx >= 0) next[blankIdx] = { ...next[blankIdx], ...row };
        else next.push(row);
      }
      return next.length > 0 ? next : [blankUpgradeRow()];
    });

    setFixedRows((rows) => {
      const next = { ...rows };
      if (isCorner && !rows.COR.userEdited) {
        const corDefaults = computeDefaults('COR', priceList, currency, bookingType);
        next.COR = {
          ...rows.COR, code: 'COR', description: corDefaults.description, unit_price: corDefaults.unit_price,
          tax_code_id: corDefaults.tax_code_id, category: corDefaults.category, included: true, qty: 1,
        };
      }
      if (isLoading && !rows.LOD.userEdited) {
        const lodDefaults = computeDefaults('LOD', priceList, currency, bookingType, Number(newBas.unit_price) || 0, lodPct);
        next.LOD = {
          ...rows.LOD, code: 'LOD', description: lodDefaults.description, unit_price: lodDefaults.unit_price,
          tax_code_id: lodDefaults.tax_code_id, category: lodDefaults.category, included: true, qty: sqmNum || 1,
        };
      }
      // MEP goes with any physical booth allocation by default — Sales can
      // still untick it afterward if this particular deal genuinely doesn't
      // include it.
      if (rows.MEP.userEdited) return next;
      const mepDefaults = computeDefaults('MEP', priceList, currency, bookingType);
      next.MEP = {
        ...rows.MEP, code: 'MEP', description: mepDefaults.description, unit_price: mepDefaults.unit_price,
        tax_code_id: mepDefaults.tax_code_id, category: mepDefaults.category, included: true, qty: 1,
      };
      return next;
    });
  }

  // Re-prices every included row from the Price List at the given tier/
  // currency — called by the parent the moment the user changes either
  // dropdown, so rates follow the price list instead of freezing at whatever
  // tier/currency was selected first. Rows with no price-list entry (custom
  // SPO/OTH lines) keep their manually typed rate. Takes the new values as
  // arguments because the parent calls this in the same tick it updates its
  // own form state — the props this component sees are still the old ones.
  function repriceAll(nextCurrency = currency, nextBookingType = bookingType) {
    const basDefaults = computeDefaults('BAS', priceList, nextCurrency, nextBookingType);
    const basRate = Number(basDefaults.unit_price) || (bas.included ? Number(bas.unit_price) || 0 : 0);

    const reprice = (row, code) => {
      if (!row.included || !code) return row;
      const d = computeDefaults(code, priceList, nextCurrency, nextBookingType, basRate, lodPct);
      if (d.unit_price === '' || d.unit_price === undefined) return row;
      return { ...row, unit_price: d.unit_price };
    };

    setBas((r) => reprice(r, 'BAS'));
    setUpgradeRows((rows) => rows.map((r) => reprice(r, r.code)));
    setFixedRows((rows) => Object.fromEntries(Object.entries(rows).map(([c, r]) => [c, reprice(r, c)])));
  }

  useImperativeHandle(ref, () => ({
    save: (targetParentId, editReason) => doSave(targetParentId || parentId, editReason),
    hasRows: () => allRows.some((row) => row.included && row.code),
    applyBoothAllocation,
    repriceAll,
    // Reads the current sheet WITHOUT saving it anywhere — used by the
    // Credit Note "adjust the actual line items" flow (SalesOrderDetail.jsx),
    // which renders a second, scratch BillingTemplate instance seeded from
    // the same items and never calls save() on it; the CN amount is the
    // difference between this total and the real, persisted one.
    getSnapshot: () => ({
      items: allRows.filter((row) => row.included && row.code).map((row) => ({
        sales_item_code: row.code, description: row.description,
        qty: Number(row.qty) || 0, unit_price: Number(row.unit_price) || 0,
        discount_value: row.discount_value || null,
        tax_code_id: row.tax_code_id || null,
        line_total: calcLineTotal(row, taxCodes),
      })),
      total: liveTotal,
    }),
  }));

  async function handleSave() {
    if (!window.confirm('Save the billing template?')) return;
    setError('');
    setSaving(true);
    try {
      await doSave(parentId);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <fieldset disabled={readOnly} style={{ border: 'none', margin: 0, padding: 0 }}>
      <div style={{ overflowX: 'auto' }}>
        <table cellPadding="4" style={{ fontSize: 13, minWidth: 900 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
              <th></th><th>Code</th><th>Description</th><th>Qty</th><th>Rate ({currency})</th><th>Discount (% / Amt)</th><th>Tax</th><th style={{ textAlign: 'right' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            <NarrowRow code="BAS" checked={bas.included} onToggle={toggleBas} row={bas} onField={setBasField}
              priceList={priceList} currency={currency} bookingType={bookingType} taxCodes={taxCodes} />
            {upgradeRows.map((r) => {
              // A code already picked on another row is hidden from this
              // row's dropdown — one exhibitor can carry several DIFFERENT
              // upgrade tiers, but the same tier twice would just be a
              // confusing way to enter a bigger qty on one row.
              const otherCodes = new Set(upgradeRows.filter((x) => x.rowKey !== r.rowKey).map((x) => x.code).filter(Boolean));
              const availableCodes = upgradeCodes.filter((c) => !otherCodes.has(c));
              return (
                <UpgradeRow
                  key={r.rowKey} upgrade={r} onSelectUpgrade={(code) => selectUpgradeRow(r.rowKey, code)}
                  onField={(field, value) => setUpgradeRowField(r.rowKey, field, value)}
                  onRemove={() => removeUpgradeRow(r.rowKey)} canRemove={upgradeRows.length > 1}
                  priceList={priceList} currency={currency} bookingType={bookingType} taxCodes={taxCodes} availableCodes={availableCodes}
                />
              );
            })}
            <tr>
              <td></td>
              <td colSpan={7} style={{ paddingBottom: 6 }}>
                <button type="button" onClick={addUpgradeRow} style={{ padding: '3px 10px', fontSize: 12 }}>+ Add another upgrade option</button>
              </td>
            </tr>
            {addonCodes.map((code) => (
              <NarrowRow
                key={code} code={code} checked={fixedRows[code]?.included} onToggle={(checked) => toggleFixed(code, checked)}
                row={fixedRows[code] || blankRow(code)} onField={(field, value) => setFixedField(code, field, value)}
                priceList={priceList} currency={currency} bookingType={bookingType} taxCodes={taxCodes}
                basUnitPrice={currentBasRate()}
                lodPct={lodPct}
              />
            ))}
            {wideRowCodes.map((code) => (
              <WideRow
                key={code} code={code} checked={fixedRows[code]?.included} onToggle={(checked) => toggleFixed(code, checked)}
                row={fixedRows[code] || blankRow(code)} onField={(field, value) => setFixedField(code, field, value)}
                priceList={priceList} currency={currency} bookingType={bookingType} taxCodes={taxCodes}
              />
            ))}
          </tbody>
        </table>
      </div>
      </fieldset>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {showSaveButton && !readOnly && (
            <button type="button" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save Billing'}
            </button>
          )}
          {rightActions}
          {/* Right at eye level next to Save, not buried up in the table,
              so a validation failure (e.g. upgrade sqm over Bare Space) is
              impossible to miss. */}
          {error && (
            <span style={{ color: '#B23A3A', fontSize: 13, fontWeight: 600, background: '#FBE3E3', padding: '4px 10px', borderRadius: 6 }}>
              {error}
            </span>
          )}
        </div>
        <div style={{ fontWeight: 700, fontSize: 15 }}>
          Total ({currency}): {liveTotal.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
      </div>
    </div>
  );
});

export default BillingTemplate;
