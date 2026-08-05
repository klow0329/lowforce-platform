import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { downloadPdf } from '../utils/pdf';
import { amountInWords } from '../utils/amountInWords';
import { BrandLogo, EventBrandLogo, LetterheadBand, FooterBand } from '../components/CompanyBranding';

const fmt = (n) => Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Booth-area items are priced per sqm, everything else is a flat per-unit
// charge — the reference invoices show this as a "Unit" column (SQM / EA).
// Not stored on the line item itself, so it's derived from the item code.
const SQM_CODES = ['BAS', 'SSS', 'ESS', 'WOP', 'CUB', 'COR', 'LOD'];
const unitFor = (code) => (SQM_CODES.includes(code) ? 'SQM' : 'EA');

export default function InvoicePrint() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState(null);
  const [company, setCompany] = useState(null);
  const [contractItems, setContractItems] = useState([]);

  useEffect(() => {
    Promise.all([api.getInvoice(id), api.getCompany()]).then(([inv, c]) => {
      setInvoice(inv.invoice);
      setCompany(c.company);
      api.listSalesOrderItems(inv.invoice.sales_order_id).then(({ items }) => setContractItems(items));
    });
  }, [id]);

  if (!invoice || !company) return <p style={{ maxWidth: 800, margin: '40px auto' }}>Loading...</p>;

  const billToType = invoice.bill_to_type || 'BILLING';
  const same = billToType === 'EXHIBITOR' || invoice.billing_same_as_company;
  const billTo = {
    name: billToType === 'AGENT' ? (invoice.agent_name || invoice.company_name)
      : billToType === 'EXHIBITOR' ? invoice.company_name
      : (invoice.billing_name || invoice.company_name),
    regNo: same ? invoice.reg_no : invoice.billing_reg_no,
    address: invoice.billing_address || '—',
    postcodeCity: [same ? invoice.postcode : invoice.billing_postcode, same ? invoice.city : invoice.billing_city]
      .filter(Boolean).join(' '),
    country: (same ? invoice.country_code : invoice.billing_country_code) || '—',
    tinNo: same ? invoice.tin_no : invoice.billing_tin_no,
    sstNo: same ? invoice.sst_no : invoice.billing_sst_no,
    contactNo: same ? invoice.contact1_phone : invoice.billing_contact_no,
    contactName: invoice.contact1_name,
    email: (same ? invoice.contact1_email : invoice.billing_email) || '—',
  };

  // The invoice only stores its own confirmed amount_foreign (tax-inclusive)
  // — never the split-up line items. To itemize it the way the reference
  // invoices do, each contract line is scaled by this invoice's real share
  // of the contract's tax-inclusive total, so the printed lines always sum
  // back to the actual invoiced/confirmed amount, never a recomputed figure
  // that could drift if the contract's items changed after this was issued.
  const contractTotalInclusive = contractItems.reduce((sum, it) => sum + Number(it.line_total || 0), 0);
  const factor = contractTotalInclusive > 0 ? Number(invoice.amount_foreign) / contractTotalInclusive : 1;
  const hasItems = contractItems.length > 0 && contractTotalInclusive > 0;

  const lines = hasItems
    ? contractItems.map((it) => {
        const preTax = (Number(it.subtotal || 0) - Number(it.discount_amount || 0)) * factor;
        const disc = Number(it.discount_amount || 0) * factor;
        const tax = Number(it.tax_amount || 0) * factor;
        return {
          taxCode: it.tax_code || '—',
          taxRate: Number(it.tax_rate_pct || 0),
          description: it.description,
          qty: it.qty,
          unit: unitFor(it.sales_item_code),
          unitPrice: it.unit_price,
          disc,
          preTax,
          tax,
        };
      })
    : [{
        taxCode: '—', taxRate: 0,
        description: invoice.booth_type
          ? `Exhibition Booth Space — ${invoice.booth_type}${invoice.total_sqm ? ` (${invoice.total_sqm} sqm)` : ''}`
          : `Exhibition Booth Space — ${invoice.event_name}`,
        qty: 1, unit: 'EA', unitPrice: invoice.amount_foreign, disc: 0,
        preTax: Number(invoice.amount_foreign), tax: 0,
      }];

  const subTotal = lines.reduce((s, l) => s + l.preTax, 0);
  const taxTotal = lines.reduce((s, l) => s + l.tax, 0);
  const grandTotal = subTotal + taxTotal;

  // Group by tax code for the Tax Summary block at the bottom.
  const taxSummary = [];
  for (const l of lines) {
    if (l.tax <= 0 && l.taxRate <= 0) continue;
    let group = taxSummary.find((g) => g.taxCode === l.taxCode && g.taxRate === l.taxRate);
    if (!group) { group = { taxCode: l.taxCode, taxRate: l.taxRate, amount: 0, tax: 0 }; taxSummary.push(group); }
    group.amount += l.preTax;
    group.tax += l.tax;
  }

  const eventDates = invoice.event_start_date && invoice.event_end_date
    ? `${invoice.event_start_date} - ${invoice.event_end_date}` : '';

  return (
    <div className="page" style={{ maxWidth: 800, margin: '40px auto' }}>
      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
        <button type="button" onClick={() => navigate(`/invoices/${id}`)}>Back</button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => downloadPdf('pdf-doc', invoice.invoice_no)}>Download PDF</button>
          <button type="button" onClick={() => window.print()}>Print</button>
        </div>
      </div>

      <div id="pdf-doc" style={{ fontSize: 13, position: 'relative' }}>
        {invoice.status === 'DRAFT' && (
          <div
            style={{
              position: 'absolute', top: '40%', left: '50%', transform: 'translate(-50%, -50%) rotate(-30deg)',
              fontSize: 96, fontWeight: 800, color: 'rgba(200,60,60,0.18)', letterSpacing: 8,
              pointerEvents: 'none', zIndex: 1, whiteSpace: 'nowrap',
            }}
          >
            DRAFT
          </div>
        )}
        <LetterheadBand company={company} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <BrandLogo company={company} height={44} />
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1B3A6B' }}>{company.name}</div>
            {company.reg_no && <div>Co. Reg. {company.reg_no}{company.tin_no ? `  TIN: ${company.tin_no}` : ''}</div>}
            {company.sst_no && <div>SST: {company.sst_no}</div>}
            {company.address && <div style={{ whiteSpace: 'pre-line', color: '#5c6070' }}>{company.address}</div>}
            {(company.phone || company.email) && (
              <div style={{ color: '#5c6070' }}>{[company.phone, company.email].filter(Boolean).join(' | ')}</div>
            )}
          </div>
          <div style={{ textAlign: 'center', alignSelf: 'center' }}>
            <EventBrandLogo company={company} height={44} style={{ margin: '0 auto' }} />
          </div>
          <div style={{ textAlign: 'right' }}>
            <h2 style={{ margin: '0 0 8px' }}>TAX INVOICE</h2>
            <div>No: <strong>{invoice.invoice_no}</strong></div>
            <div>Date: {invoice.invoice_date || '—'}</div>
          </div>
        </div>

        <div style={{ border: '1px solid #ddd', borderRadius: 6, padding: 12, marginBottom: 12 }}>
          <div style={{ fontWeight: 700 }}>{billTo.name}</div>
          {billTo.regNo && <div>Business Registration No.: {billTo.regNo}</div>}
          <div>{billTo.address}</div>
          {billTo.postcodeCity && <div>{billTo.postcodeCity}</div>}
          <div>{billTo.country}</div>
          <div style={{ display: 'flex', gap: 24, marginTop: 6 }}>
            {billTo.contactNo && <span>Tel: {billTo.contactNo}</span>}
            {billTo.contactName && <span>Attn: {billTo.contactName}</span>}
          </div>
          <div style={{ display: 'flex', gap: 24 }}>
            <span>SST ID No.: {billTo.sstNo || '—'}</span>
            <span>TIN No.: {billTo.tinNo || '—'}</span>
          </div>
        </div>

        <p style={{ fontWeight: 600, marginBottom: 4 }}>
          {invoice.event_name}{eventDates ? ` ${eventDates}` : ''}
        </p>

        <table width="100%" cellPadding="6" style={{ marginBottom: 4, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #1B3A6B', fontSize: 12 }}>
              <th style={{ width: 28 }}>#</th>
              <th>Description</th>
              <th style={{ textAlign: 'right' }}>Qty</th>
              <th>Unit</th>
              <th style={{ textAlign: 'right' }}>Unit Price</th>
              <th style={{ textAlign: 'right' }}>Disc.</th>
              <th style={{ textAlign: 'right' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                <td>{i + 1}.</td>
                <td>{l.description}</td>
                <td style={{ textAlign: 'right' }}>{Number(l.qty)}</td>
                <td>{l.unit}</td>
                <td style={{ textAlign: 'right' }}>{fmt(l.unitPrice)}</td>
                <td style={{ textAlign: 'right' }}>{l.disc > 0.004 ? fmt(l.disc) : ''}</td>
                <td style={{ textAlign: 'right' }}>{fmt(l.preTax)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {invoice.booth_no && <p style={{ fontSize: 12, color: '#5c6070' }}>Booth No: {invoice.booth_no}</p>}

        {invoice.billing_pct && Number(invoice.billing_pct) < 100 && (
          <p style={{ fontSize: 12, fontWeight: 600 }}>
            Note: Progressive bill — {Number(invoice.billing_pct)}% of contract value.
          </p>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, marginTop: 16, alignItems: 'flex-start' }}>
          <p style={{ fontSize: 12, maxWidth: 320 }}>{amountInWords(grandTotal, invoice.currency)}</p>
          <table cellPadding="4" style={{ minWidth: 260 }}>
            <tbody>
              <tr>
                <td>Sub Total (Excluding Tax)</td>
                <td style={{ textAlign: 'right', border: '1px solid #ccc', padding: '2px 8px' }}>{fmt(subTotal)}</td>
              </tr>
              <tr>
                <td>Tax</td>
                <td style={{ textAlign: 'right', border: '1px solid #ccc', padding: '2px 8px' }}>{fmt(taxTotal)}</td>
              </tr>
              <tr style={{ fontWeight: 700 }}>
                <td>Total (Inclusive of Tax)</td>
                <td style={{ textAlign: 'right', border: '1px solid #ccc', padding: '2px 8px' }}>{fmt(grandTotal)} {invoice.currency}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {invoice.billing_pct && Number(invoice.billing_pct) < 100 && invoice.contract_total_foreign && (
          <p style={{ textAlign: 'right', fontWeight: 700, marginTop: 4 }}>
            Total Contract Value: {fmt(invoice.contract_total_foreign)} ({invoice.currency})
          </p>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, marginTop: 24, borderTop: '1px solid #ddd', paddingTop: 16 }}>
          <div style={{ fontSize: 12, maxWidth: 340 }}>
            <p style={{ fontWeight: 700, marginBottom: 4 }}>Payment Instructions:</p>
            {company.payment_instructions ? (
              <p style={{ whiteSpace: 'pre-line' }}>{company.payment_instructions}</p>
            ) : (
              <ol style={{ margin: 0, paddingLeft: 16 }}>
                <li>Full payment is required on an immediate basis upon receipt of invoice.</li>
                <li>Cheque should be crossed and made payable to {company.name}.</li>
                <li>Please quote the invoice number on your payment.</li>
              </ol>
            )}
            {(company.bank_name || company.bank_account_no) && (
              <>
                <p style={{ fontWeight: 700, margin: '12px 0 4px' }}>Payment Details:</p>
                <p>Beneficiary: {company.name}</p>
                {company.bank_account_no && <p>A/C No: {company.bank_account_no}</p>}
                {company.bank_name && <p>Bank Name: {company.bank_name}</p>}
                {company.bank_swift && <p>Bank Swift Code: {company.bank_swift}</p>}
              </>
            )}
          </div>
          {taxSummary.length > 0 && (
            <table cellPadding="4" style={{ fontSize: 12, height: 'fit-content' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #ccc', fontWeight: 700 }}>
                  <td>Tax Summary</td><td style={{ textAlign: 'right' }}>Amount</td><td style={{ textAlign: 'right' }}>Tax</td>
                </tr>
              </thead>
              <tbody>
                {taxSummary.map((g, i) => (
                  <tr key={i}>
                    <td>{g.taxCode} @ {g.taxRate}%</td>
                    <td style={{ textAlign: 'right' }}>{fmt(g.amount)}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(g.tax)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <p style={{ marginTop: 24, fontSize: 11, color: '#5c6070', fontStyle: 'italic' }}>
          This is a system-generated tax invoice and does not require a signature.
        </p>
        <FooterBand company={company} />
      </div>
    </div>
  );
}
