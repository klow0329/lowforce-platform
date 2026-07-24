import { useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import { api } from '../api/client';

// The standard MIFB booth-order billing template: Bare Space is the base
// item, the exhibitor can upgrade to ONE of Shell Scheme/Enhanced Shell/
// Walk-On/Custom Build, then Corner/Loading/MEP/Badge/Sponsorship/Other are
// independent optional add-ons. Sponsorship and Other get a wide free-text
// row since they carry open-ended agreement details; keeping them adjacent
// at the bottom of the sheet is what the reference layout expects.
const UPGRADE_CODES = ['SSS', 'ESS', 'WOP', 'CUB'];
const NARROW_ROW_CODES = ['COR', 'LOD', 'MEP', 'BAD'];
const WIDE_ROW_CODES = ['SPO', 'OTH'];
const FIXED_ROW_CODES = [...NARROW_ROW_CODES, ...WIDE_ROW_CODES];
export const TEMPLATE_CODES = ['BAS', ...UPGRADE_CODES, ...FIXED_ROW_CODES];

const FIXED_LABELS = {
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
// List admin screen. LOD has no Price List rate of its own — its rate is
// always 15% of Bare Space's current rate (basUnitPrice, passed by the
// caller), not looked up.
function computeDefaults(code, priceList, currency, bookingType, basUnitPrice) {
  if (!code) return { description: '', unit_price: '', tax_code_id: '', category: undefined };
  const pl = findPriceListEntry(priceList, code, bookingType);
  let unit_price = pl ? ((currency === 'USD' ? pl.unit_price_usd : pl.unit_price_myr) ?? '') : '';
  if (code === 'LOD') {
    // Price list values arrive as NUMERIC strings from Postgres (already
    // fixed to 2dp, e.g. "1350.00") — match that formatting here too,
    // otherwise a clean 15% split (e.g. 202.5) shows one decimal short.
    const bas = Number(basUnitPrice) || 0;
    unit_price = bas > 0 ? (Math.round(bas * 0.15 * 100) / 100).toFixed(2) : '';
  }
  return {
    description: (FIXED_LABELS[code] || pl?.description || code).toUpperCase(),
    unit_price,
    tax_code_id: pl?.default_tax_code_id || '',
    category: pl?.category,
  };
}

function blankRow(code) {
  return { id: null, code, description: '', qty: '', unit_price: '', discount_value: '', tax_code_id: '', included: false };
}

function rowFromItem(it) {
  return {
    id: it.id, code: it.sales_item_code,
    description: it.description || '', qty: it.qty, unit_price: it.unit_price,
    discount_value: it.discount_value ?? '', tax_code_id: it.tax_code_id || '',
    included: true,
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

function NarrowRow({ code, checked, onToggle, row, onField, priceList, currency, bookingType, taxCodes, basUnitPrice }) {
  const display = row.included ? row : { ...row, ...computeDefaults(code, priceList, currency, bookingType, basUnitPrice) };
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
        <input type="number" step="0.01" style={smallInput} value={display.unit_price} disabled={!row.included} onChange={(e) => onField('unit_price', e.target.value)} />
      </td>
      <td style={{ width: COL.discount }}><DiscountCell row={row} onField={onField} /></td>
      <td style={{ width: COL.tax }}><TaxSelect taxCodeId={display.tax_code_id} included={row.included} taxCodes={taxCodes} onField={onField} /></td>
      <td style={{ width: COL.total, textAlign: 'right', fontWeight: 600 }}>{row.included ? fmtTotal(total) : '—'}</td>
    </tr>
  );
}

function UpgradeRow({ upgradeCode, upgrade, onSelectUpgrade, onField, priceList, currency, bookingType, taxCodes }) {
  const display = upgrade.included ? upgrade : { ...upgrade, ...computeDefaults(upgradeCode, priceList, currency, bookingType) };
  const total = upgrade.included ? calcLineTotal(upgrade, taxCodes) : 0;
  return (
    <tr style={{ borderBottom: '1px solid #eee' }}>
      <td></td>
      <td style={{ width: COL.code }}>
        <select style={smallInput} value={upgradeCode} onChange={(e) => onSelectUpgrade(e.target.value)}>
          <option value="">— None —</option>
          {UPGRADE_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </td>
      <td>
        <input style={smallInput} value={display.description} disabled={!upgrade.included} onChange={(e) => onField('description', e.target.value.toUpperCase())} />
      </td>
      <td style={{ width: COL.qty }}>
        <input type="number" step="0.01" style={smallInput} value={upgrade.included ? upgrade.qty : ''} disabled={!upgrade.included} onChange={(e) => onField('qty', e.target.value)} />
      </td>
      <td style={{ width: COL.rate }}>
        <input type="number" step="0.01" style={smallInput} value={display.unit_price} disabled={!upgrade.included} onChange={(e) => onField('unit_price', e.target.value)} />
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
  { parentType, parentId, currency, bookingType, items, priceList, taxCodes, onSaved, showSaveButton = true }, ref
) {
  const { add: apiAdd, update: apiUpdate, remove: apiRemove } = ENDPOINTS[parentType];

  const [bas, setBas] = useState(blankRow('BAS'));
  const [upgradeCode, setUpgradeCode] = useState('');
  const [upgrade, setUpgrade] = useState(blankRow(''));
  const [fixedRows, setFixedRows] = useState(() => Object.fromEntries(FIXED_ROW_CODES.map((c) => [c, blankRow(c)])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const byCode = {};
    for (const it of items) {
      if (TEMPLATE_CODES.includes(it.sales_item_code)) byCode[it.sales_item_code] = it;
    }

    setBas(byCode.BAS ? rowFromItem(byCode.BAS) : blankRow('BAS'));

    const upgradeItem = UPGRADE_CODES.map((c) => byCode[c]).find(Boolean);
    if (upgradeItem) {
      setUpgradeCode(upgradeItem.sales_item_code);
      setUpgrade(rowFromItem(upgradeItem));
    } else {
      setUpgradeCode('');
      setUpgrade(blankRow(''));
    }

    setFixedRows(Object.fromEntries(FIXED_ROW_CODES.map((c) => [c, byCode[c] ? rowFromItem(byCode[c]) : blankRow(c)])));
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
    const d = computeDefaults(code, priceList, currency, bookingType, code === 'LOD' ? currentBasRate() : undefined);
    return { ...row, code, description: d.description, unit_price: d.unit_price, tax_code_id: d.tax_code_id, category: d.category, included: true, qty: row.qty || 1 };
  }

  function toggleBas(checked) {
    setBas((r) => (checked ? applyDefaults(r, 'BAS') : { ...r, included: false, qty: '' }));
  }

  function setBasField(field, value) {
    setBas((r) => ({ ...r, [field]: value }));
  }

  // Switching the upgrade dropdown re-uses the same underlying line item
  // (update its code in place) rather than deleting and re-adding.
  // Qty defaults to BAS's own qty (the booth's sqm) when one's already
  // allocated — an upgrade is priced per sqm same as Bare Space, it's just a
  // different build tier, not a different size.
  function selectUpgrade(code) {
    setUpgradeCode(code);
    setUpgrade((r) => {
      if (!code) return { ...r, code: '', included: false, qty: '' };
      if (r.code === code) return r;
      const row = applyDefaults({ ...blankRow(code), id: r.id }, code);
      return bas.included ? { ...row, qty: bas.qty } : row;
    });
  }

  function setUpgradeField(field, value) {
    setUpgrade((r) => ({ ...r, [field]: value }));
  }

  function toggleFixed(code, checked) {
    setFixedRows((rows) => ({ ...rows, [code]: checked ? applyDefaults(rows[code], code) : { ...rows[code], included: false, qty: '' } }));
  }

  function setFixedField(code, field, value) {
    setFixedRows((rows) => ({ ...rows, [code]: { ...rows[code], [field]: value } }));
  }

  const allRows = [bas, upgrade, ...Object.values(fixedRows)];
  const liveTotal = allRows.reduce((sum, row) => sum + (row.included ? calcLineTotal(row, taxCodes) : 0), 0);

  // The actual sync-to-server logic, parameterized by the target parent id
  // rather than reading the parentId prop directly — a brand-new record has
  // no id until the parent's own create call returns one.
  async function doSave(targetParentId) {
    const ops = [];

    for (const row of allRows) {
      if (row.included && row.code) {
        const payload = {
          sales_item_code: row.code,
          description: row.description,
          category: row.category || (row.code === 'BAS' || UPGRADE_CODES.includes(row.code) ? 'BOOTH' : 'OTHER'),
          // A row can be checked before the Price List has a rate for it
          // (e.g. no USD price set for an item) — never send '' to a
          // NOT NULL numeric column, default to 0 so Finance can fix it up.
          qty: Number(row.qty) || 0,
          unit_price: Number(row.unit_price) || 0,
          discount_type: row.discount_value ? 'PERCENT' : null,
          discount_value: row.discount_value || null,
          tax_code_id: row.tax_code_id || null,
        };
        ops.push(row.id ? apiUpdate(targetParentId, row.id, payload) : apiAdd(targetParentId, payload));
      } else if (row.id) {
        ops.push(apiRemove(targetParentId, row.id));
      }
    }

    await Promise.all(ops);
  }

  // Populates the sheet from a Floor Plan booth pick: BAS is always
  // qty=sqm (it's priced per sqm), LOD too (15% of the bare space rate,
  // same per-sqm basis) if the booth is flagged loading, COR at a flat
  // qty=1 (it's a per-unit charge, not per-sqm) if flagged corner. Computed
  // directly via computeDefaults rather than the stateful applyDefaults/
  // currentBasRate helpers, since those read `bas` from the CURRENT render
  // — which is still the old value while this function is still running,
  // so LOD's 15%-of-BAS rate would otherwise be computed off a stale BAS.
  function applyBoothAllocation({ sqm, isCorner, isLoading }) {
    const sqmNum = Number(sqm) || 0;
    const basDefaults = computeDefaults('BAS', priceList, currency, bookingType);
    const newBas = {
      ...bas, code: 'BAS', description: basDefaults.description, unit_price: basDefaults.unit_price,
      tax_code_id: basDefaults.tax_code_id, category: basDefaults.category, included: true, qty: sqmNum || 1,
    };
    setBas(newBas);

    // An upgrade already chosen for this booth is priced per sqm same as
    // Bare Space — keep its qty matched to the new sqm rather than leaving
    // it at whatever the previous booth's size was.
    if (upgrade.included) {
      setUpgrade((r) => ({ ...r, qty: sqmNum || 1 }));
    }

    setFixedRows((rows) => {
      const next = { ...rows };
      if (isCorner) {
        const corDefaults = computeDefaults('COR', priceList, currency, bookingType);
        next.COR = {
          ...rows.COR, code: 'COR', description: corDefaults.description, unit_price: corDefaults.unit_price,
          tax_code_id: corDefaults.tax_code_id, category: corDefaults.category, included: true, qty: 1,
        };
      }
      if (isLoading) {
        const lodDefaults = computeDefaults('LOD', priceList, currency, bookingType, Number(newBas.unit_price) || 0);
        next.LOD = {
          ...rows.LOD, code: 'LOD', description: lodDefaults.description, unit_price: lodDefaults.unit_price,
          tax_code_id: lodDefaults.tax_code_id, category: lodDefaults.category, included: true, qty: sqmNum || 1,
        };
      }
      // MEP goes with any physical booth allocation by default — Sales can
      // still untick it afterward if this particular deal genuinely doesn't
      // include it.
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
      const d = computeDefaults(code, priceList, nextCurrency, nextBookingType, code === 'LOD' ? basRate : undefined);
      if (d.unit_price === '' || d.unit_price === undefined) return row;
      return { ...row, unit_price: d.unit_price };
    };

    setBas((r) => reprice(r, 'BAS'));
    setUpgrade((r) => reprice(r, r.code));
    setFixedRows((rows) => Object.fromEntries(Object.entries(rows).map(([c, r]) => [c, reprice(r, c)])));
  }

  useImperativeHandle(ref, () => ({
    save: (targetParentId) => doSave(targetParentId || parentId),
    hasRows: () => allRows.some((row) => row.included && row.code),
    applyBoothAllocation,
    repriceAll,
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
            <UpgradeRow upgradeCode={upgradeCode} upgrade={upgrade} onSelectUpgrade={selectUpgrade} onField={setUpgradeField}
              priceList={priceList} currency={currency} bookingType={bookingType} taxCodes={taxCodes} />
            {NARROW_ROW_CODES.map((code) => (
              <NarrowRow
                key={code} code={code} checked={fixedRows[code].included} onToggle={(checked) => toggleFixed(code, checked)}
                row={fixedRows[code]} onField={(field, value) => setFixedField(code, field, value)}
                priceList={priceList} currency={currency} bookingType={bookingType} taxCodes={taxCodes}
                basUnitPrice={code === 'LOD' ? currentBasRate() : undefined}
              />
            ))}
            {WIDE_ROW_CODES.map((code) => (
              <WideRow
                key={code} code={code} checked={fixedRows[code].included} onToggle={(checked) => toggleFixed(code, checked)}
                row={fixedRows[code]} onField={(field, value) => setFixedField(code, field, value)}
                priceList={priceList} currency={currency} bookingType={bookingType} taxCodes={taxCodes}
              />
            ))}
          </tbody>
        </table>
      </div>

      {error && <p style={{ color: 'red', fontSize: 13 }}>{error}</p>}
      <div style={{ display: 'flex', justifyContent: showSaveButton ? 'space-between' : 'flex-end', alignItems: 'center', marginTop: 12 }}>
        {showSaveButton && (
          <button type="button" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Billing'}
          </button>
        )}
        <div style={{ fontWeight: 700, fontSize: 15 }}>
          Total ({currency}): {liveTotal.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
      </div>
    </div>
  );
});

export default BillingTemplate;
