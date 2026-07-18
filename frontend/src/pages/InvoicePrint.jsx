import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { downloadPdf } from '../utils/pdf';

const fmtMYR = (n) => `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const line = { display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #eee' };

export default function InvoicePrint() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState(null);
  const [company, setCompany] = useState(null);

  useEffect(() => {
    Promise.all([api.getInvoice(id), api.getCompany()]).then(([inv, c]) => {
      setInvoice(inv.invoice);
      setCompany(c.company);
    });
  }, [id]);

  if (!invoice || !company) return <p style={{ maxWidth: 700, margin: '40px auto' }}>Loading...</p>;

  const same = invoice.billing_same_as_company;
  const billTo = {
    name: same ? invoice.company_name : (invoice.billing_name || invoice.company_name),
    address: invoice.billing_address || '—',
    postcodeCity: [same ? invoice.postcode : invoice.billing_postcode, same ? invoice.city : invoice.billing_city]
      .filter(Boolean).join(' '),
    country: (same ? invoice.country_code : invoice.billing_country_code) || '—',
    regNo: same ? invoice.reg_no : invoice.billing_reg_no,
    tinNo: same ? invoice.tin_no : invoice.billing_tin_no,
    sstNo: same ? invoice.sst_no : invoice.billing_sst_no,
    contactNo: same ? invoice.contact1_phone : invoice.billing_contact_no,
    email: (same ? invoice.contact1_email : invoice.billing_email) || '—',
  };

  const description = invoice.booth_type
    ? `Exhibition Booth Space — ${invoice.booth_type}${invoice.booth_sqm ? ` (${invoice.booth_sqm} sqm)` : ''}`
    : `Exhibition Booth Space — ${invoice.event_name}`;

  return (
    <div className="page" style={{ maxWidth: 700, margin: '40px auto' }}>
      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
        <button type="button" onClick={() => navigate(`/invoices/${id}`)}>Back</button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => downloadPdf('pdf-doc', invoice.invoice_no)}>Download PDF</button>
          <button type="button" onClick={() => window.print()}>Print</button>
        </div>
      </div>

      <div id="pdf-doc">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <img src="/logo.png" alt="" style={{ height: 44, display: 'block', marginBottom: 6 }} />
          <div style={{ fontSize: 20, fontWeight: 700, color: '#1B3A6B' }}>{company.name}</div>
          <div style={{ fontSize: 14, color: '#5c6070' }}>{invoice.event_name}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <h2 style={{ margin: 0 }}>INVOICE</h2>
          <div style={{ fontSize: 13 }}>No: {invoice.invoice_no}</div>
          <div style={{ fontSize: 13 }}>Date: {invoice.invoice_date || '—'}</div>
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
            <td style={{ textAlign: 'right' }}>{fmtMYR(invoice.amount_myr)}</td>
          </tr>
        </tbody>
      </table>

      {invoice.discount_type && (
        <div style={line}>
          <span>Discount Applied</span>
          <span>
            {invoice.discount_type === 'PERCENT'
              ? `${Number(invoice.discount_value)}%`
              : fmtMYR(invoice.discount_value)}
          </span>
        </div>
      )}
      <div style={{ ...line, fontWeight: 700, fontSize: 16, borderBottom: '2px solid #1B3A6B' }}>
        <span>Total Due</span><span>{fmtMYR(invoice.amount_myr)}</span>
      </div>

      <p style={{ fontSize: 12, color: '#5c6070', marginTop: 24 }}>
        Please quote {invoice.invoice_no} as your payment reference.
      </p>
      </div>
    </div>
  );
}
