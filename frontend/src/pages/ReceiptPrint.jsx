import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { downloadPdf } from '../utils/pdf';

const fmtMYR = (n) => `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const line = { display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #eee' };

export default function ReceiptPrint() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [payment, setPayment] = useState(null);
  const [company, setCompany] = useState(null);

  useEffect(() => {
    Promise.all([api.getPayment(id), api.getCompany()]).then(([p, c]) => {
      setPayment(p.payment);
      setCompany(c.company);
    });
  }, [id]);

  if (!payment || !company) return <p style={{ maxWidth: 700, margin: '40px auto' }}>Loading...</p>;

  return (
    <div className="page" style={{ maxWidth: 700, margin: '40px auto' }}>
      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
        <button type="button" onClick={() => navigate(`/payments/${id}`)}>Back</button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => downloadPdf('pdf-doc', payment.receipt_no || 'receipt')}>Download PDF</button>
          <button type="button" onClick={() => window.print()}>Print</button>
        </div>
      </div>

      <div id="pdf-doc">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <img src="/logo.png" alt="" style={{ height: 44, display: 'block', marginBottom: 6 }} />
          <div style={{ fontSize: 20, fontWeight: 700, color: '#1B3A6B' }}>{company.name}</div>
          <div style={{ fontSize: 14, color: '#5c6070' }}>{payment.event_name}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <h2 style={{ margin: 0 }}>OFFICIAL RECEIPT</h2>
          <div style={{ fontSize: 13 }}>No: {payment.receipt_no}</div>
          <div style={{ fontSize: 13 }}>Date: {payment.payment_date || '—'}</div>
        </div>
      </div>

      <div style={{ marginBottom: 24 }}>
        <h4>Received From</h4>
        <div>{payment.company_name}</div>
      </div>

      <div style={line}><span>Being payment for Invoice No.</span><span>{payment.invoice_no}</span></div>
      <div style={line}><span>Payment Method</span><span>{payment.payment_method || '—'}</span></div>
      <div style={line}><span>Bank Reference</span><span>{payment.bank_ref || '—'}</span></div>
      <div style={{ ...line, fontWeight: 700, fontSize: 16, borderBottom: '2px solid #1B3A6B' }}>
        <span>Amount Received</span><span>{fmtMYR(payment.amount_myr)}</span>
      </div>

      <div style={{ marginTop: 64 }}>
        <div style={{ borderTop: '1px solid #333', paddingTop: 4, maxWidth: 300 }}>
          For and on behalf of {company.name}
        </div>
      </div>
      </div>
    </div>
  );
}
