import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { downloadPdf } from '../utils/pdf';
import { BrandLogo, LetterheadBand, FooterBand } from '../components/CompanyBranding';

const fmtMYR = (n) => `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const line = { display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #eee' };

export default function ContractPrint() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [salesOrder, setSalesOrder] = useState(null);
  const [company, setCompany] = useState(null);

  useEffect(() => {
    Promise.all([api.getSalesOrder(id), api.getCompany()]).then(([so, c]) => {
      setSalesOrder(so.salesOrder);
      setCompany(c.company);
    });
  }, [id]);

  if (!salesOrder || !company) return <p style={{ maxWidth: 700, margin: '40px auto' }}>Loading...</p>;

  const isCoex = salesOrder.contract_type === 'COEX';
  const docTitle = isCoex ? 'CO-EXHIBITOR CONTRACT' : 'EXHIBITION SPACE CONTRACT';

  // Which name prints as the recipient — chosen on the Contract screen (see
  // SalesOrderDetail.jsx's Bill To dropdown), not just derived from the
  // exhibitor's billing_same_as_company flag. EXHIBITOR skips the separate
  // "Bill To" column entirely below (redundant with the Exhibitor column);
  // BILLING/AGENT still fall back to the exhibitor's own address/contact
  // fields, since neither billing_name nor an agent carries a full address.
  const billToType = salesOrder.bill_to_type || 'BILLING';
  const same = billToType === 'EXHIBITOR' || salesOrder.billing_same_as_company;
  const billTo = {
    name: billToType === 'AGENT' ? (salesOrder.agent_name || salesOrder.company_name)
      : billToType === 'EXHIBITOR' ? salesOrder.company_name
      : (salesOrder.billing_name || salesOrder.company_name),
    address: salesOrder.billing_address || '—',
    postcodeCity: [same ? salesOrder.postcode : salesOrder.billing_postcode, same ? salesOrder.city : salesOrder.billing_city]
      .filter(Boolean).join(' '),
    country: (same ? salesOrder.country_code : salesOrder.billing_country_code) || '—',
    regNo: same ? salesOrder.reg_no : salesOrder.billing_reg_no,
    tinNo: same ? salesOrder.tin_no : salesOrder.billing_tin_no,
    sstNo: same ? salesOrder.sst_no : salesOrder.billing_sst_no,
    contactNo: same ? salesOrder.contact1_phone : salesOrder.billing_contact_no,
    email: (same ? salesOrder.contact1_email : salesOrder.billing_email) || '—',
  };

  return (
    <div className="page" style={{ maxWidth: 700, margin: '40px auto' }}>
      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
        <button type="button" onClick={() => navigate(`/sales-orders/${id}`)}>Back</button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => downloadPdf('pdf-doc', `contract-${salesOrder.legacy_order_no || id.slice(0, 8)}`)}>
            Download PDF
          </button>
          <button type="button" onClick={() => window.print()}>Print</button>
        </div>
      </div>

      <div id="pdf-doc">
      <LetterheadBand company={company} />
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <BrandLogo company={company} height={48} style={{ margin: '0 auto 8px' }} />
        <div style={{ fontSize: 20, fontWeight: 700, color: '#1B3A6B' }}>{company.name}</div>
        <div style={{ fontSize: 14, color: '#5c6070' }}>{salesOrder.event_name}</div>
        <h2 style={{ marginTop: 16, marginBottom: 0 }}>{docTitle}</h2>
        {isCoex && (
          <p style={{ fontSize: 12, color: '#5c6070' }}>
            This exhibitor participates under the sponsorship of the main exhibitor booth holder.
          </p>
        )}
      </div>

      <div style={{ display: 'flex', gap: 32, marginBottom: 24 }}>
        <div style={{ flex: 1 }}>
          <h4>Exhibitor</h4>
          <div>{salesOrder.company_name}</div>
          <div>{salesOrder.country_code || '—'}</div>
          <div>{salesOrder.contact1_name || '—'}</div>
          <div>{salesOrder.contact1_email || '—'}</div>
        </div>
        {billToType !== 'EXHIBITOR' && (
          <div style={{ flex: 1 }}>
            <h4>Bill To</h4>
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
        )}
      </div>

      <h4>Contract Details</h4>
      <div style={line}><span>Contract Type</span><span>{isCoex ? 'Co-Exhibitor (CoEX)' : 'Standard'}</span></div>
      <div style={line}><span>Contract Date</span><span>{salesOrder.contract_date || '—'}</span></div>
      <div style={line}><span>Booking Type</span><span>{salesOrder.booking_type || '—'}</span></div>
      <div style={line}><span>Hall / Booth No</span><span>{[salesOrder.hall, salesOrder.booth_no].filter(Boolean).join(' / ') || '—'}</span></div>
      <div style={line}><span>Booth Type</span><span>{salesOrder.booth_type || '—'}</span></div>
      <div style={line}><span>Dimension</span><span>{salesOrder.dimension || '—'}</span></div>
      <div style={line}><span>Booth Area</span><span>{salesOrder.total_sqm ? `${salesOrder.total_sqm} sqm` : '—'}</span></div>
      <div style={line}><span>Salesperson</span><span>{salesOrder.salesperson_name || '—'}</span></div>
      {salesOrder.discount_type && (
        <div style={line}>
          <span>Discount Applied</span>
          <span>
            {salesOrder.discount_type === 'PERCENT'
              ? `${Number(salesOrder.discount_value)}%`
              : fmtMYR(salesOrder.discount_value)}
          </span>
        </div>
      )}
      <div style={{ ...line, fontWeight: 700, fontSize: 16, borderBottom: '2px solid #1B3A6B' }}>
        <span>Total Contract Value</span><span>{fmtMYR(salesOrder.total_myr)}</span>
      </div>

      <div style={{ display: 'flex', gap: 32, marginTop: 64 }}>
        <div style={{ flex: 1 }}>
          <div style={{ borderTop: '1px solid #333', paddingTop: 4 }}>For and on behalf of {company.name}</div>
          <div style={{ marginTop: 32, borderTop: '1px solid #333', paddingTop: 4 }}>Date</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ borderTop: '1px solid #333', paddingTop: 4 }}>For and on behalf of {salesOrder.company_name}</div>
          <div style={{ marginTop: 32, borderTop: '1px solid #333', paddingTop: 4 }}>Date</div>
        </div>
      </div>

      {company.contract_terms && (
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
