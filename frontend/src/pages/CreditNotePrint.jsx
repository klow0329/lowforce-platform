import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { downloadPdf } from '../utils/pdf';
import { BrandLogo, LetterheadBand, FooterBand } from '../components/CompanyBranding';

const fmtMYR = (n) => `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const line = { display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #eee' };

export default function CreditNotePrint() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [cn, setCn] = useState(null);
  const [company, setCompany] = useState(null);

  useEffect(() => {
    Promise.all([api.getCreditNote(id), api.getCompany()]).then(([r, c]) => {
      setCn(r.creditNote);
      setCompany(c.company);
    });
  }, [id]);

  if (!cn || !company) return <p style={{ maxWidth: 700, margin: '40px auto' }}>Loading...</p>;

  return (
    <div className="page" style={{ maxWidth: 700, margin: '40px auto' }}>
      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
        <button type="button" onClick={() => navigate(`/sales-orders/${cn.sales_order_id}`)}>Back</button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => downloadPdf('pdf-doc', cn.cn_no || 'credit-note')}>Download PDF</button>
          <button type="button" onClick={() => window.print()}>Print</button>
        </div>
      </div>

      <div id="pdf-doc">
      <LetterheadBand company={company} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <BrandLogo company={company} height={44} />
          <div style={{ fontSize: 20, fontWeight: 700, color: '#1B3A6B' }}>{company.name}</div>
          <div style={{ fontSize: 14, color: '#5c6070' }}>{cn.event_name}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <h2 style={{ margin: 0 }}>CREDIT NOTE</h2>
          <div style={{ fontSize: 13 }}>No: {cn.cn_no}</div>
          <div style={{ fontSize: 13 }}>Date: {cn.cn_date || '—'}</div>
        </div>
      </div>

      <div style={{ marginBottom: 24 }}>
        <h4>Issued To</h4>
        <div>{cn.exhibitor_name}</div>
      </div>

      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: '#5c6070', paddingBottom: 2 }}>Against invoice:</div>
        <div style={line}><span>Invoice No. {cn.invoice_no}</span><span>{fmtMYR(cn.invoice_amount_myr)}</span></div>
      </div>
      <div style={line}><span>Reason</span><span style={{ textAlign: 'right', maxWidth: 380 }}>{cn.reason}</span></div>
      <div style={{ ...line, fontWeight: 700, fontSize: 16, borderBottom: '2px solid #1B3A6B' }}>
        <span>Credit Amount</span><span>{fmtMYR(cn.amount_myr)}</span>
      </div>

      <p style={{ marginTop: 48, fontSize: 11, color: '#5c6070' }}>
        This credit note has been confirmed and applied against the invoice above.
      </p>
      <p style={{ fontSize: 11, color: '#5c6070', fontStyle: 'italic' }}>
        This is a system-generated credit note and does not require a signature.
      </p>
      <FooterBand company={company} />
      </div>
    </div>
  );
}
