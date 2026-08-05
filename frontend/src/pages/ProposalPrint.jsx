import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { downloadPdf } from '../utils/pdf';
import { BrandLogo, EventBrandLogo, LetterheadBand, FooterBand } from '../components/CompanyBranding';

const fmt = (n, ccy = 'MYR') => `${ccy === 'USD' ? 'USD' : 'RM'} ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const todayStr = () => new Date().toISOString().slice(0, 10);

// Booth-area items are priced per sqm, everything else is a flat per-unit
// charge — same convention as ProformaPrint.jsx/InvoicePrint.jsx.
const SQM_CODES = ['BAS', 'SSS', 'ESS', 'WOP', 'CUB', 'COR', 'LOD'];
const unitFor = (code) => (SQM_CODES.includes(code) ? 'SQM' : 'EA');

// A pre-signature version of ProformaPrint.jsx — same layout, but sourced
// from an Opportunity (and its own opportunity_items) rather than a
// Contract/Sales Order, since a Proposal is what Sales sends BEFORE there's
// a signed deal to generate a real Contract from.
export default function ProposalPrint() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [opportunity, setOpportunity] = useState(null);
  const [company, setCompany] = useState(null);
  const [items, setItems] = useState([]);

  useEffect(() => {
    // Company is fetched once the opportunity's event_id is known —
    // getCompany uses it to resolve the right MAIN event's own logo.
    Promise.all([api.getOpportunity(id), api.listOpportunityItems(id)]).then(([o, it]) => {
      setOpportunity(o.opportunity);
      setItems(it.items);
      api.getCompany(o.opportunity.event_id).then((c) => setCompany(c.company));
    });
  }, [id]);

  if (!opportunity || !company) return <p style={{ maxWidth: 700, margin: '40px auto' }}>Loading...</p>;

  const ccy = opportunity.currency;
  const lines = items.length > 0
    ? items.map((it) => ({
        description: it.description, qty: it.qty, unit: unitFor(it.sales_item_code),
        unitPrice: it.unit_price, disc: Number(it.discount_amount || 0), preTax: Number(it.subtotal || 0) - Number(it.discount_amount || 0),
        tax: Number(it.tax_amount || 0), taxCode: it.tax_code || '—', taxRate: Number(it.tax_rate_pct || 0),
      }))
    : [{
        description: opportunity.booth_type
          ? `Exhibition Booth Space — ${opportunity.booth_type}${opportunity.total_sqm ? ` (${opportunity.total_sqm} sqm)` : ''}`
          : `Exhibition Booth Space — ${opportunity.event_name}`,
        qty: 1, unit: 'EA', unitPrice: opportunity.total_foreign, disc: 0,
        preTax: Number(opportunity.total_foreign || 0), tax: 0, taxCode: '—', taxRate: 0,
      }];
  const subTotal = lines.reduce((s, l) => s + l.preTax, 0);
  const taxTotal = lines.reduce((s, l) => s + l.tax, 0);
  const grandTotal = subTotal + taxTotal;

  const billToType = opportunity.bill_to_type || 'BILLING';
  const same = billToType === 'EXHIBITOR' || opportunity.billing_same_as_company;
  const billTo = {
    name: billToType === 'AGENT' ? (opportunity.agent_name || opportunity.exhibitor_name)
      : billToType === 'EXHIBITOR' ? opportunity.exhibitor_name
      : (opportunity.billing_name || opportunity.exhibitor_name),
    address: opportunity.billing_address || '—',
    postcodeCity: [same ? opportunity.postcode : opportunity.billing_postcode, same ? opportunity.city : opportunity.billing_city]
      .filter(Boolean).join(' '),
    country: (same ? opportunity.country_code : opportunity.billing_country_code) || '—',
    regNo: same ? opportunity.reg_no : opportunity.billing_reg_no,
    tinNo: same ? opportunity.tin_no : opportunity.billing_tin_no,
    sstNo: same ? opportunity.sst_no : opportunity.billing_sst_no,
    contactNo: same ? opportunity.contact1_phone : opportunity.billing_contact_no,
    email: (same ? opportunity.contact1_email : opportunity.billing_email) || '—',
  };

  const proposalNo = `PR-${id.slice(0, 8).toUpperCase()}`;

  return (
    <div className="page" style={{ maxWidth: 700, margin: '40px auto' }}>
      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
        <button type="button" onClick={() => navigate(`/opportunities/${id}`)}>Back</button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => downloadPdf('pdf-doc', proposalNo)}>Download PDF</button>
          <button type="button" onClick={() => window.print()}>Print</button>
        </div>
      </div>

      <div id="pdf-doc">
      <LetterheadBand company={company} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <BrandLogo company={company} height={44} />
          <div style={{ fontSize: 20, fontWeight: 700, color: '#1B3A6B' }}>{company.name}</div>
          <div style={{ fontSize: 14, color: '#5c6070' }}>{opportunity.event_name}</div>
        </div>
        <div style={{ textAlign: 'center', alignSelf: 'center' }}>
          <EventBrandLogo company={company} height={56} style={{ margin: '0 auto' }} />
        </div>
        <div style={{ textAlign: 'right' }}>
          <h2 style={{ margin: 0 }}>PROPOSAL</h2>
          <div style={{ fontSize: 13 }}>No: {proposalNo}</div>
          <div style={{ fontSize: 13 }}>Date: {todayStr()}</div>
        </div>
      </div>

      <div style={{ marginBottom: 24 }}>
        <h4>Prepared For</h4>
        <div>{billTo.name}</div>
        <div>{billTo.address}</div>
        {billTo.postcodeCity && <div>{billTo.postcodeCity}</div>}
        <div>{billTo.country}</div>
        {billTo.regNo && <div>Co. Reg No: {billTo.regNo}</div>}
        {billTo.tinNo && <div>TIN No: {billTo.tinNo}</div>}
        {billTo.sstNo && <div>SST No: {billTo.sstNo}</div>}
        {billTo.contactNo && <div>Contact: {billTo.contactNo}</div>}
        <div>{billTo.email}</div>
      </div>

      <table width="100%" cellPadding="6" style={{ marginBottom: 4, fontSize: 13 }}>
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
              <td style={{ textAlign: 'right' }}>{fmt(l.unitPrice, ccy)}</td>
              <td style={{ textAlign: 'right' }}>{l.disc > 0.004 ? fmt(l.disc, ccy) : ''}</td>
              <td style={{ textAlign: 'right' }}>{fmt(l.preTax, ccy)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {opportunity.booth_no && <p style={{ fontSize: 12, color: '#5c6070' }}>Booth No: {opportunity.booth_no}</p>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <table cellPadding="4" style={{ minWidth: 260 }}>
          <tbody>
            <tr>
              <td>Sub Total (Excluding Tax)</td>
              <td style={{ textAlign: 'right', border: '1px solid #ccc', padding: '2px 8px' }}>{fmt(subTotal, ccy)}</td>
            </tr>
            <tr>
              <td>Tax</td>
              <td style={{ textAlign: 'right', border: '1px solid #ccc', padding: '2px 8px' }}>{fmt(taxTotal, ccy)}</td>
            </tr>
            <tr style={{ fontWeight: 700 }}>
              <td>Total Due</td>
              <td style={{ textAlign: 'right', border: '1px solid #ccc', padding: '2px 8px' }}>{fmt(grandTotal, ccy)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 12, color: '#5c6070', marginTop: 24 }}>
        This is a proposal for reference purposes only and is not a tax invoice, proforma invoice or receipt.
        Please quote {proposalNo} in any correspondence about this proposal.
      </p>
      <FooterBand company={company} />
      </div>
    </div>
  );
}
