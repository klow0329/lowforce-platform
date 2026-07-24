import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { downloadPdf } from '../utils/pdf';
import { BrandLogo, LetterheadBand, FooterBand } from '../components/CompanyBranding';

const fmtMYR = (n) => `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const todayStr = () => new Date().toISOString().slice(0, 10);

const line = { display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #eee' };

export default function ProformaPrint() {
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

  const same = salesOrder.billing_same_as_company;
  const billTo = {
    name: same ? salesOrder.company_name : (salesOrder.billing_name || salesOrder.company_name),
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

  const proformaNo = `PF-${id.slice(0, 8).toUpperCase()}`;
  const description = salesOrder.booth_type
    ? `Exhibition Booth Space — ${salesOrder.booth_type}${salesOrder.booth_sqm ? ` (${salesOrder.booth_sqm} sqm)` : ''}`
    : `Exhibition Booth Space — ${salesOrder.event_name}`;

  return (
    <div className="page" style={{ maxWidth: 700, margin: '40px auto' }}>
      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
        <button type="button" onClick={() => navigate(`/sales-orders/${id}`)}>Back</button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => downloadPdf('pdf-doc', proformaNo)}>Download PDF</button>
          <button type="button" onClick={() => window.print()}>Print</button>
        </div>
      </div>

      <div id="pdf-doc">
      <LetterheadBand company={company} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <BrandLogo company={company} height={44} />
          <div style={{ fontSize: 20, fontWeight: 700, color: '#1B3A6B' }}>{company.name}</div>
          <div style={{ fontSize: 14, color: '#5c6070' }}>{salesOrder.event_name}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <h2 style={{ margin: 0 }}>PROFORMA INVOICE</h2>
          <div style={{ fontSize: 13 }}>No: {proformaNo}</div>
          <div style={{ fontSize: 13 }}>Date: {todayStr()}</div>
        </div>
      </div>

      <div style={{ marginBottom: 24 }}>
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

      <table width="100%" cellPadding="6" style={{ marginBottom: 16 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid #1B3A6B' }}>
            <th>Description</th>
            <th style={{ textAlign: 'right' }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ borderBottom: '1px solid #eee' }}>
            <td>{description}</td>
            <td style={{ textAlign: 'right' }}>{fmtMYR(salesOrder.total_myr)}</td>
          </tr>
        </tbody>
      </table>

      <div style={{ ...line, fontWeight: 700, fontSize: 16, borderBottom: '2px solid #1B3A6B' }}>
        <span>Total Due</span><span>{fmtMYR(salesOrder.total_myr)}</span>
      </div>

      <p style={{ fontSize: 12, color: '#5c6070', marginTop: 24 }}>
        This is a proforma invoice for payment purposes only and is not a tax invoice or receipt.
        Full payment is due prior to the official Invoice and Official Receipt being issued.
        Please quote {proformaNo} as your payment reference.
      </p>
      <FooterBand company={company} />
      </div>
    </div>
  );
}
