import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { downloadPdf } from '../utils/pdf';
import { BrandLogo, EventBrandLogo, LetterheadBand, FooterBand } from '../components/CompanyBranding';

const fmt = (n) => Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
}

// One combined range when both ends are set and differ ("1 - 3 Oct 2027"),
// falls back to a single date, or blank if the Event Edition has neither set.
function fmtDateRange(start, end) {
  if (start && end && start !== end) return `${fmtDate(start)} - ${fmtDate(end)}`;
  return fmtDate(start || end);
}

const sectionTitle = {
  background: '#1B3A6B', color: '#fff', padding: '3px 10px', fontSize: 12, fontWeight: 700,
  letterSpacing: 0.4, marginTop: 14, marginBottom: 8,
};
const fieldGrid = { display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 24, rowGap: 4, fontSize: 12 };
const fieldLabel = { color: '#5c6070', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.3 };
const fieldValue = { fontSize: 12.5 };
const th = { textAlign: 'left', fontSize: 11, padding: '4px 6px', borderBottom: '1.5px solid #1B3A6B', color: '#1B3A6B' };
const td = { fontSize: 12, padding: '3px 6px', borderBottom: '1px solid #eee' };

function Field({ label, value, span }) {
  return (
    <div style={span ? { gridColumn: '1 / -1' } : undefined}>
      <div style={fieldLabel}>{label}</div>
      <div style={fieldValue}>{value || '—'}</div>
    </div>
  );
}

export default function ContractPrint() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [salesOrder, setSalesOrder] = useState(null);
  const [company, setCompany] = useState(null);
  const [items, setItems] = useState([]);

  useEffect(() => {
    // Sequential, not parallel — getCompany needs the contract's event_id to
    // resolve the right MAIN event's own logo, and the items list needs the
    // contract to already exist.
    api.getSalesOrder(id).then((so) => {
      setSalesOrder(so.salesOrder);
      api.getCompany(so.salesOrder.event_id).then((c) => setCompany(c.company));
      api.listSalesOrderItems(id).then((r) => setItems(r.items));
    });
  }, [id]);

  if (!salesOrder || !company) return <p style={{ maxWidth: 700, margin: '40px auto' }}>Loading...</p>;

  const isCoex = salesOrder.contract_type === 'COEX';
  const docTitle = isCoex ? 'CO-EXHIBITOR CONTRACT' : 'EXHIBITION SPACE APPLICATION FORM';
  const currency = salesOrder.currency || 'MYR';
  const fmtCur = (n) => `${fmt(n)} ${currency}`;

  // Which name prints as the recipient — chosen on the Contract screen (see
  // SalesOrderDetail.jsx's Bill To dropdown), not just derived from the
  // exhibitor's billing_same_as_company flag.
  const billToType = salesOrder.bill_to_type || 'BILLING';
  const same = billToType === 'EXHIBITOR' || salesOrder.billing_same_as_company;
  const billTo = {
    name: billToType === 'AGENT' ? (salesOrder.agent_name || salesOrder.company_name)
      : billToType === 'EXHIBITOR' ? salesOrder.company_name
      : (salesOrder.billing_name || salesOrder.company_name),
    address: salesOrder.billing_address || '',
    postcodeCity: [same ? salesOrder.postcode : salesOrder.billing_postcode, same ? salesOrder.city : salesOrder.billing_city]
      .filter(Boolean).join(' '),
    country: (same ? salesOrder.country_name : salesOrder.billing_country_name) || '',
    contactNo: same ? salesOrder.contact1_phone : salesOrder.billing_contact_no,
    email: (same ? salesOrder.contact1_email : salesOrder.billing_email) || '',
  };

  // Split the contract's real billed line items into the top "booth" block
  // (Bare Space + any upgrade tier) and everything else — category is set
  // at save time (BillingTemplate.jsx) from the Price List item's own
  // category, or derived as BOOTH/OTHER if unset. Zero-amount rows never
  // get this far in the first place (only checked/included rows are
  // persisted), but line_total > 0 guards defensively per the user's own
  // "those without any number do not include" instruction.
  const billedItems = items.filter((it) => Number(it.line_total) > 0);
  const boothItems = billedItems.filter((it) => it.category === 'BOOTH');
  const otherItems = billedItems.filter((it) => it.category !== 'BOOTH');
  const itemSubtotal = billedItems.reduce((s, it) => s + Number(it.subtotal) - Number(it.discount_amount), 0);
  const itemTax = billedItems.reduce((s, it) => s + Number(it.tax_amount), 0);
  const itemTotal = billedItems.reduce((s, it) => s + Number(it.line_total), 0);

  // "Preferred Hall / Booth No." — some exhibitors take many booths at once
  // (multi-booth mass pickup, see Floor Plan), and a long comma-separated
  // booth list doesn't fit this line cleanly. Per the user's own call: if it
  // can't fit, leave the field blank rather than truncating awkwardly.
  const boothCount = (salesOrder.booth_no || '').split(',').map((s) => s.trim()).filter(Boolean).length;
  const hallBoothFits = boothCount > 0 && boothCount <= 10 && (salesOrder.booth_no || '').length <= 60;
  const hallBoothDisplay = hallBoothFits ? [salesOrder.hall, salesOrder.booth_no].filter(Boolean).join(' / ') : '';

  const showBillingDetails = !same;
  const showContact2 = !!salesOrder.contact2_name;

  return (
    <div className="page" style={{ maxWidth: 760, margin: '40px auto' }}>
      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
        <button type="button" onClick={() => navigate(`/sales-orders/${id}`)}>Back</button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => downloadPdf('pdf-doc', `contract-${salesOrder.legacy_order_no || id.slice(0, 8)}`, 'portrait', {
              appendPdfUrl: company.has_contract_terms_pdf ? api.brandingImageUrl('contract_terms_pdf') : undefined,
            })}
          >
            Download PDF
          </button>
          <button type="button" onClick={() => window.print()}>Print</button>
        </div>
      </div>

      <div id="pdf-doc" style={{ fontSize: 12.5, lineHeight: 1.4 }}>
      <LetterheadBand company={company} />
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        {/* A <table> here, not a flex row — html2canvas (the PDF export
            engine) has long-standing bugs rendering flexbox-centered
            sibling images, which showed up as the two logos collapsing
            into one spot in the exported PDF even though the on-screen
            preview looked fine. A table's cells lay out reliably in both
            the browser and html2canvas's canvas rendering. Cells are only
            emitted for logos that actually exist, so a company with just
            one configured logo still gets a genuinely centered table
            instead of one real cell plus an empty, off-centering one. */}
        <table style={{ margin: '0 auto 8px', borderCollapse: 'collapse' }}><tbody><tr>
          {company.has_event_logo && (
            <td style={{ padding: '0 20px', verticalAlign: 'middle' }}><EventBrandLogo company={company} height={64} style={{ margin: 0 }} /></td>
          )}
          {company.has_logo && (
            <td style={{ padding: '0 20px', verticalAlign: 'middle' }}><BrandLogo company={company} height={64} style={{ margin: 0 }} /></td>
          )}
        </tr></tbody></table>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1B3A6B' }}>{company.name}</div>
        <div style={{ fontSize: 13, color: '#5c6070' }}>{company.event_name || salesOrder.event_name}</div>
        <h2 style={{ marginTop: 12, marginBottom: 0, fontSize: 18 }}>{docTitle}</h2>
        {!isCoex && (
          <p style={{ fontSize: 10.5, color: '#5c6070', maxWidth: 520, margin: '4px auto 0' }}>
            This is an application to participate. A binding contract is formed only upon written acceptance by
            the Event Organiser.
          </p>
        )}
        {isCoex && (
          <p style={{ fontSize: 11, color: '#5c6070' }}>
            This exhibitor participates under the sponsorship of the main exhibitor booth holder.
          </p>
        )}
      </div>

      <div style={sectionTitle}>SECTION 1 &mdash; EVENT DETAILS</div>
      <div style={fieldGrid}>
        <Field label="Event Name" value={salesOrder.event_name} span />
        <Field label="Venue" value={salesOrder.event_venue} span />
        <Field label="Event Dates" value={fmtDateRange(salesOrder.event_start_date, salesOrder.event_end_date)} />
        <Field label="Contract Type" value={isCoex ? 'Co-Exhibitor (CoEX)' : 'Standard'} />
        <Field label="Contract Date" value={fmtDate(salesOrder.contract_date)} />
        <Field label="Rate Tier / Booking Type" value={salesOrder.booking_type} />
      </div>

      <div style={sectionTitle}>SECTION 2 &mdash; EXHIBITOR&rsquo;S DETAILS</div>
      <div style={fieldGrid}>
        <Field label="Company Name" value={salesOrder.company_name} />
        <Field label="Alternative / Native Name" value={salesOrder.company_name_alt} />
        <Field label="Company Reg. No." value={salesOrder.reg_no} />
        <Field label="TIN No." value={salesOrder.tin_no} />
        <Field label="SST No." value={salesOrder.sst_no} />
        <Field label="Website" value={salesOrder.website} />
        <Field label="Address" value={[salesOrder.address, salesOrder.postcode, salesOrder.city, salesOrder.state].filter(Boolean).join(', ')} span />
        <Field label="Country" value={salesOrder.country_name} />
        <Field label="Fax" value={salesOrder.fax} />
        <Field label="Contact Person 1" value={salesOrder.contact1_name} />
        <Field label="Designation" value={salesOrder.contact1_job_title} />
        <Field label="Mobile No." value={salesOrder.contact1_phone} />
        <Field label="Business Email" value={salesOrder.contact1_email} />
        {showContact2 && (
          <>
            <Field label="Contact Person 2" value={salesOrder.contact2_name} />
            <Field label="Designation" value={salesOrder.contact2_job_title} />
            <Field label="Mobile No." value={salesOrder.contact2_phone} />
            <Field label="Business Email" value={salesOrder.contact2_email} />
          </>
        )}
      </div>

      {showBillingDetails && (
        <>
          <div style={{ ...fieldLabel, marginTop: 10, marginBottom: 4 }}>Billing Details (if different from above)</div>
          <div style={fieldGrid}>
            <Field label="Billing Name" value={billTo.name} />
            <Field label="Billing Address" value={[billTo.address, billTo.postcodeCity].filter(Boolean).join(', ')} />
            <Field label="Country" value={billTo.country} />
            <Field label="Billing Contact No." value={billTo.contactNo} />
            <Field label="Billing Email" value={billTo.email} span />
          </div>
        </>
      )}

      <div style={sectionTitle}>SECTION 3 &mdash; BOOKED SPACE AND PARTICIPATION FEES</div>
      <table width="100%" cellPadding={0} cellSpacing={0} style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>Item</th>
            <th style={{ ...th, textAlign: 'right' }}>Qty</th>
            <th style={{ ...th, textAlign: 'right' }}>Rate</th>
            <th style={{ ...th, textAlign: 'right' }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {boothItems.map((it) => (
            <tr key={it.id}>
              <td style={td}>{it.description}</td>
              <td style={{ ...td, textAlign: 'right' }}>{it.qty}</td>
              <td style={{ ...td, textAlign: 'right' }}>{fmt(it.unit_price)}</td>
              <td style={{ ...td, textAlign: 'right' }}>{fmt(Number(it.subtotal) - Number(it.discount_amount))}</td>
            </tr>
          ))}
          {otherItems.map((it) => (
            <tr key={it.id}>
              <td style={td}>{it.description}</td>
              <td style={{ ...td, textAlign: 'right' }}>{it.qty}</td>
              <td style={{ ...td, textAlign: 'right' }}>{fmt(it.unit_price)}</td>
              <td style={{ ...td, textAlign: 'right' }}>{fmt(Number(it.subtotal) - Number(it.discount_amount))}</td>
            </tr>
          ))}
          {billedItems.length === 0 && (
            <tr><td colSpan={4} style={{ ...td, color: '#5c6070' }}>No items billed yet.</td></tr>
          )}
          <tr>
            <td colSpan={3} style={{ ...td, textAlign: 'right', fontWeight: 600 }}>Sub-total (before tax)</td>
            <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmt(itemSubtotal)}</td>
          </tr>
          <tr>
            <td colSpan={3} style={{ ...td, textAlign: 'right', fontWeight: 600 }}>Tax</td>
            <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmt(itemTax)}</td>
          </tr>
          <tr>
            <td colSpan={3} style={{ ...td, textAlign: 'right', fontWeight: 700, fontSize: 13.5, borderBottom: '2px solid #1B3A6B' }}>
              Total Participation Fees
            </td>
            <td style={{ ...td, textAlign: 'right', fontWeight: 700, fontSize: 13.5, borderBottom: '2px solid #1B3A6B' }}>
              {fmtCur(itemTotal)}
            </td>
          </tr>
        </tbody>
      </table>

      <div style={{ ...fieldGrid, marginTop: 10 }}>
        <Field label="Preferred Hall / Booth No. (subject to availability and allocation)" value={hallBoothDisplay} span />
        {salesOrder.remarks && <Field label="Remarks" value={salesOrder.remarks} span />}
      </div>

      {/* Forced page break: everything from here on (Payment + Declaration)
          starts on a fresh page 2, rather than letting html2pdf's
          auto-pagination cut wherever content happens to overflow — which
          previously split the Payment section's bank-details grid in half
          across two pages. */}
      <div style={{ pageBreakBefore: 'always', paddingTop: 8 }}>
      <div style={sectionTitle}>SECTION 4 &mdash; PAYMENT</div>
      {company.payment_terms_wording && (
        <p style={{ fontSize: 11, color: '#333', marginTop: 0 }}>{company.payment_terms_wording}</p>
      )}
      <div style={fieldGrid}>
        <Field label="Account Name" value={company.name} />
        <Field label="Bank" value={company.bank_name} />
        <Field label="Account No." value={company.bank_account_no} />
        <Field label="SWIFT Code" value={company.bank_swift} />
        {company.payment_instructions && <Field label="Remittance / Other Instructions" value={company.payment_instructions} span />}
      </div>

      <div style={sectionTitle}>SECTION 5 &mdash; EXHIBITOR&rsquo;S DECLARATION AND SIGNATURE</div>
      {company.declaration_wording && (
        <p style={{ fontSize: 11, color: '#333', marginTop: 0 }}>{company.declaration_wording}</p>
      )}
      <div style={{ marginTop: 32 }}>
        <div style={{ display: 'flex', gap: 32 }}>
          <div style={{ flex: 1, borderTop: '1px solid #333', paddingTop: 4, fontSize: 11 }}>
            Name / Signature &amp; Company Stamp (Exhibitor)
          </div>
          <div style={{ flex: 1, borderTop: '1px solid #333', paddingTop: 4, fontSize: 11 }}>
            Designation / Date
          </div>
        </div>
      </div>
      <div style={{
        marginTop: 20, border: '1px solid #ccc', borderRadius: 4, padding: 8, fontSize: 10.5, color: '#5c6070',
      }}>
        <strong>For Office Use Only</strong> &mdash; Salesperson: {salesOrder.salesperson_name || '—'}
        &nbsp;&nbsp;Rate Tier: {salesOrder.booking_type || '—'}
      </div>
      </div>

      {company.contract_terms && !company.has_contract_terms_pdf && (
        <div style={{ pageBreakBefore: 'always', marginTop: 32 }}>
          <h4>Terms &amp; Conditions</h4>
          <div style={{ fontSize: 12, whiteSpace: 'pre-line', color: '#333' }}>{company.contract_terms}</div>
        </div>
      )}
      <FooterBand company={company} />
      </div>
    </div>
  );
}
