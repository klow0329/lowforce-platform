import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';

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

  const billTo = invoice.billing_same_as_company
    ? {
        name: invoice.company_name,
        address: invoice.billing_address || '—',
        country: invoice.billing_country_code || invoice.country_code || '—',
        email: invoice.contact1_email || '—',
      }
    : {
        name: invoice.billing_name || invoice.company_name,
        address: invoice.billing_address || '—',
        country: invoice.billing_country_code || '—',
        email: invoice.billing_email || '—',
      };

  const description = invoice.booth_type
    ? `Exhibition Booth Space — ${invoice.booth_type}${invoice.booth_sqm ? ` (${invoice.booth_sqm} sqm)` : ''}`
    : `Exhibition Booth Space — ${invoice.event_name}`;

  return (
    <div style={{ maxWidth: 700, margin: '40px auto' }}>
      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
        <button type="button" onClick={() => navigate(`/invoices/${id}`)}>Back</button>
        <button type="button" onClick={() => window.print()}>Print</button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
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
        <div>{billTo.country}</div>
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

      <div style={{ ...line, fontWeight: 700, fontSize: 16, borderBottom: '2px solid #1B3A6B' }}>
        <span>Total Due</span><span>{fmtMYR(invoice.amount_myr)}</span>
      </div>

      <p style={{ fontSize: 12, color: '#5c6070', marginTop: 24 }}>
        Please quote {invoice.invoice_no} as your payment reference.
      </p>
    </div>
  );
}
