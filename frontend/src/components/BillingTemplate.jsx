import { useEffect, useState } from 'react';
import { api } from '../api/client';

// The standard MIFB booth-order billing template: Bare Space is the base
// item, the exhibitor can upgrade to ONE of Shell Scheme/Enhanced Shell/
// Walk-On/Custom Build, then Corner/Loading/MEP/Sponsorship/Badge/Other are
// independent optional add-ons. Fixed row order matches the reference sheet
// so this always reads the same way regardless of what's checked.
const UPGRADE_CODES = ['SSS', 'ESS', 'WOP', 'CUB'];
const FIXED_ROW_CODES = ['COR', 'LOD', 'MEP', 'SPO', 'BAD', 'OTH'];
export const TEMPLATE_CODES = ['BAS', ...UPGRADE_CODES, ...FIXED_ROW_CODES];

const smallInput = { width: '100%', padding: 6, boxSizing: 'border-box', fontSize: 13 };

function findPriceListEntry(priceList, code, bookingType) {
  if (!code) return null;
  return (
    priceList.find((p) => p.sales_item_code === code && p.booth_type === bookingType) ||
    priceList.find((p) => p.sales_item_code === code && p.booth_type === 'ALL TIERS') ||
    priceList.find((p) => p.sales_item_code === code)
  );
}

function blankRow(code) {
  return {
    id: null, code,
    description: '', qty: 1, unit_price: '', discount_type: '', discount_value: '', tax_code_id: '',
    included: false,
  };
}

function rowFromItem(it) {
  return {
    id: it.id, code: it.sales_item_code,
    description: it.description || '', qty: it.qty, unit_price: it.unit_price,
    discount_type: it.discount_type || '', discount_value: it.discount_value ?? '',
    tax_code_id: it.tax_code_id || '',
    included: true,
  };
}

function applyPriceListDefaults(row, priceList, currency, bookingType) {
  const pl = findPriceListEntry(priceList, row.code, bookingType);
  if (!pl) return row;
  return {
    ...row,
    description: row.description || pl.description || '',
    unit_price: row.unit_price !== '' && row.unit_price !== undefined ? row.unit_price : (currency === 'USD' ? pl.unit_price_usd : pl.unit_price_myr) ?? '',
    tax_code_id: row.tax_code_id || pl.default_tax_code_id || '',
    category: pl.category,
  };
}

function calcLineTotal(row, taxCodes) {
  const qty = Number(row.qty) || 0;
  const unitPrice = Number(row.unit_price) || 0;
  const subtotal = qty * unitPrice;
  let discountAmount = 0;
  if (row.discount_type === 'PERCENT') discountAmount = subtotal * (Number(row.discount_value) || 0) / 100;
  else if (row.discount_type === 'FLAT') discountAmount = Number(row.discount_value) || 0;
  const taxable = subtotal - discountAmount;
  const taxCode = taxCodes.find((t) => t.id === row.tax_code_id);
  const taxAmount = taxable * (taxCode ? Number(taxCode.rate_pct) : 0) / 100;
  return taxable + taxAmount;
}

export default function BillingTemplate({ salesOrderId, currency, bookingType, items, priceList, taxCodes, onSaved }) {
  const [bas, setBas] = useState(blankRow('BAS'));
  const [upgradeCode, setUpgradeCode] = useState('');
  const [upgrade, setUpgrade] = useState(blankRow(''));
  const [fixedRows, setFixedRows] = useState(() => Object.fromEntries(FIXED_ROW_CODES.map((c) => [c, blankRow(c)])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Rebuild the template from the server's items whenever the contract's
  // items change (initial load, after save, after an item is edited below).
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

  function toggleBas(checked) {
    setBas((r) => {
      const next = { ...r, included: checked };
      return checked ? applyPriceListDefaults(next, priceList, currency, bookingType) : next;
    });
  }

  function setBasField(field, value) {
    setBas((r) => ({ ...r, [field]: value }));
  }

  // Switching the upgrade dropdown re-uses the same underlying line item
  // (update its code in place) rather than deleting and re-adding — the id
  // and savedCode are carried across so handleSave knows to PUT, not POST.
  function selectUpgrade(code) {
    setUpgradeCode(code);
    setUpgrade((r) => {
      if (!code) return { ...r, code: '', included: false };
      if (r.code === code) return r; // no-op re-select
      return applyPriceListDefaults(
        { ...blankRow(code), id: r.id, included: true },
        priceList, currency, bookingType
      );
    });
  }

  function setUpgradeField(field, value) {
    setUpgrade((r) => ({ ...r, [field]: value }));
  }

  function toggleFixed(code, checked) {
    setFixedRows((rows) => {
      const next = { ...rows[code], included: checked };
      return { ...rows, [code]: checked ? applyPriceListDefaults(next, priceList, currency, bookingType) : next };
    });
  }

  function setFixedField(code, field, value) {
    setFixedRows((rows) => ({ ...rows, [code]: { ...rows[code], [field]: value } }));
  }

  async function handleSave() {
    if (!window.confirm('Save the billing template for this contract?')) return;
    setError('');
    setSaving(true);
    try {
      const ops = [];
      const allRows = [bas, upgrade, ...Object.values(fixedRows)];

      for (const row of allRows) {
        if (row.included && row.code) {
          const payload = {
            sales_item_code: row.code,
            description: row.description,
            category: row.category || (row.code === 'BAS' || UPGRADE_CODES.includes(row.code) ? 'BOOTH' : 'OTHER'),
            qty: row.qty, unit_price: row.unit_price,
            discount_type: row.discount_type || null, discount_value: row.discount_value || null,
            tax_code_id: row.tax_code_id || null,
          };
          ops.push(row.id ? api.updateSalesOrderItem(salesOrderId, row.id, payload) : api.addSalesOrderItem(salesOrderId, payload));
        } else if (row.id) {
          ops.push(api.deleteSalesOrderItem(salesOrderId, row.id));
        }
      }

      await Promise.all(ops);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function rowCells(row, onField, placeholder) {
    const total = row.included ? calcLineTotal(row, taxCodes) : 0;
    return (
      <>
        <td>
          <input style={smallInput} placeholder={placeholder} value={row.description} disabled={!row.included} onChange={(e) => onField('description', e.target.value)} />
        </td>
        <td style={{ width: 70 }}>
          <input type="number" step="0.01" style={smallInput} value={row.qty} disabled={!row.included} onChange={(e) => onField('qty', e.target.value)} />
        </td>
        <td style={{ width: 90 }}>
          <input type="number" step="0.01" style={smallInput} value={row.unit_price} disabled={!row.included} onChange={(e) => onField('unit_price', e.target.value)} />
        </td>
        <td style={{ width: 110 }}>
          <div style={{ display: 'flex', gap: 2 }}>
            <select style={{ ...smallInput, width: 55 }} value={row.discount_type} disabled={!row.included} onChange={(e) => onField('discount_type', e.target.value)}>
              <option value="">—</option>
              <option value="PERCENT">%</option>
              <option value="FLAT">Flat</option>
            </select>
            <input type="number" step="0.01" style={smallInput} value={row.discount_value} disabled={!row.included} onChange={(e) => onField('discount_value', e.target.value)} />
          </div>
        </td>
        <td style={{ width: 90 }}>
          <select style={smallInput} value={row.tax_code_id} disabled={!row.included} onChange={(e) => onField('tax_code_id', e.target.value)}>
            <option value="">—</option>
            {taxCodes.map((tc) => <option key={tc.id} value={tc.id}>{tc.code}</option>)}
          </select>
        </td>
        <td style={{ width: 100, textAlign: 'right', fontWeight: 600 }}>{row.included ? total.toFixed(2) : '—'}</td>
      </>
    );
  }

  function FixedRow({ code, checked, onToggle, row, onField }) {
    return (
      <tr style={{ borderBottom: '1px solid #eee' }}>
        <td style={{ width: 28 }}>
          <input type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} />
        </td>
        <td style={{ width: 70, fontWeight: 600 }}>{code}</td>
        {rowCells(row, onField, FIXED_LABELS[code])}
      </tr>
    );
  }

  function UpgradeRow() {
    return (
      <tr style={{ borderBottom: '1px solid #eee' }}>
        <td colSpan={2}>
          <select style={smallInput} value={upgradeCode} onChange={(e) => selectUpgrade(e.target.value)}>
            <option value="">— No upgrade —</option>
            {UPGRADE_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </td>
        {rowCells(upgrade, setUpgradeField, 'Booth upgrade')}
      </tr>
    );
  }

  const FIXED_LABELS = { COR: 'Corner Charge', LOD: 'Loading', MEP: 'Marketing Exposure Package', SPO: 'Sponsorship', BAD: 'Badge', OTH: 'Other' };

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table width="100%" cellPadding="4" style={{ fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
              <th></th><th>Code</th><th>Description</th><th>Qty</th><th>Rate ({currency})</th><th>Discount</th><th>Tax</th><th style={{ textAlign: 'right' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            <FixedRow code="BAS" checked={bas.included} onToggle={toggleBas} row={bas} onField={setBasField} />
            <UpgradeRow />
            {FIXED_ROW_CODES.map((code) => (
              <FixedRow
                key={code}
                code={code}
                checked={fixedRows[code].included}
                onToggle={(checked) => toggleFixed(code, checked)}
                row={fixedRows[code]}
                onField={(field, value) => setFixedField(code, field, value)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {error && <p style={{ color: 'red', fontSize: 13 }}>{error}</p>}
      <button type="button" onClick={handleSave} disabled={saving} style={{ marginTop: 12 }}>
        {saving ? 'Saving...' : 'Save Billing'}
      </button>
    </div>
  );
}
