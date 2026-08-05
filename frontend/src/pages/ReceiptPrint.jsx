import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { downloadPdf, buildPdfFilename } from '../utils/pdf';
import { BrandLogo, EventBrandLogo, LetterheadBand, FooterBand } from '../components/CompanyBranding';

const fmt = (n, ccy = 'MYR') => `${ccy === 'USD' ? 'USD' : 'RM'} ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const line = { display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #eee' };

export default function ReceiptPrint() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [payment, setPayment] = useState(null);
  const [company, setCompany] = useState(null);

  useEffect(() => {
    // Sequential, not parallel, so getCompany has the payment's event_id —
    // it uses that to resolve the right MAIN event's own logo.
    api.getPayment(id).then((p) => {
      setPayment(p.payment);
      api.getCompany(p.payment.event_id).then((c) => setCompany(c.company));
    });
  }, [id]);

  if (!payment || !company) return <p style={{ maxWidth: 700, margin: '40px auto' }}>Loading...</p>;

  return (
    <div className="page" style={{ maxWidth: 700, margin: '40px auto' }}>
      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
        <button type="button" onClick={() => navigate(`/payments/${id}`)}>Back</button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => downloadPdf('pdf-doc', buildPdfFilename(payment.receipt_no || 'receipt', payment.company_name))}>Download PDF</button>
          <button type="button" onClick={() => window.print()}>Print</button>
        </div>
      </div>

      <div id="pdf-doc">
      <LetterheadBand company={company} />
      {/* A <table> here, not a flex row — see ContractPrint/InvoicePrint's
          own comment: html2canvas doesn't reliably render flexbox-centered
          sibling images, which put the logos in the wrong spot on export
          even though the on-screen preview looked correct. */}
      <table width="100%" style={{ borderCollapse: 'collapse', marginBottom: 24 }}><tbody><tr>
        <td style={{ verticalAlign: 'top', width: '38%' }}>
          <BrandLogo company={company} height={44} />
          <div style={{ fontSize: 20, fontWeight: 700, color: '#1B3A6B' }}>{company.name}</div>
          <div style={{ fontSize: 14, color: '#5c6070' }}>{payment.event_name}</div>
        </td>
        {company.has_event_logo && (
          <td style={{ verticalAlign: 'middle', textAlign: 'center', width: '24%' }}>
            <EventBrandLogo company={company} height={56} style={{ margin: '0 auto' }} />
          </td>
        )}
        <td style={{ verticalAlign: 'top', textAlign: 'right', width: '38%' }}>
          <h2 style={{ margin: 0 }}>OFFICIAL RECEIPT</h2>
          <div style={{ fontSize: 13 }}>No: {payment.receipt_no}</div>
          <div style={{ fontSize: 13 }}>Date: {payment.payment_date || '—'}</div>
        </td>
      </tr></tbody></table>

      <div style={{ marginBottom: 24 }}>
        <h4>Received From</h4>
        <div>{payment.company_name}</div>
      </div>

      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: '#5c6070', paddingBottom: 2 }}>Being payment for:</div>
        {payment.allocations.map((a) => (
          <div key={a.id} style={line}><span>Invoice No. {a.invoice_no}</span><span>{fmt(a.amount_foreign, payment.currency)}</span></div>
        ))}
        {payment.unallocated_foreign > 0.01 && (
          <div style={line}><span>Unallocated (on account)</span><span>{fmt(payment.unallocated_foreign, payment.currency)}</span></div>
        )}
      </div>
      <div style={line}><span>Payment Method</span><span>{payment.payment_method || '—'}</span></div>
      <div style={line}><span>Bank Reference</span><span>{payment.bank_ref || '—'}</span></div>
      <div style={{ ...line, fontWeight: 700, fontSize: 16, borderBottom: '2px solid #1B3A6B' }}>
        <span>Amount Received</span><span>{fmt(payment.amount_foreign, payment.currency)}</span>
      </div>

      <p style={{ marginTop: 48, fontSize: 11, color: '#5c6070', fontStyle: 'italic' }}>
        This is a system-generated receipt and does not require a signature.
      </p>
      <FooterBand company={company} />
      </div>
    </div>
  );
}
