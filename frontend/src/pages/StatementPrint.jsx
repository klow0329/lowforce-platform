import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { downloadPdf } from '../utils/pdf';
import { BrandLogo, LetterheadBand, FooterBand } from '../components/CompanyBranding';

const fmtMYR = (n) => `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// A running balance can go negative — e.g. a Credit Note lands against an
// invoice that's already been paid in full — which reads as a confusing
// "RM -500.00" rather than the credit it actually is.
const fmtBalance = (n) => (Number(n) < 0 ? `Credit ${fmtMYR(Math.abs(n))}` : fmtMYR(n));

// "Email Statement" opens a draft in the user's own mail client with the
// customer's address and a subject/body pre-filled — no API/OAuth setup
// needed. They attach the downloaded PDF and send it themselves. Real
// send-from-LowForce (Microsoft Graph) is a separate, later undertaking.
function buildMailto(to, companyName, exhibitorName) {
  const subject = encodeURIComponent(`Statement of Account — ${exhibitorName}`);
  const body = encodeURIComponent(
    `Dear ${exhibitorName},\n\nPlease find attached your latest statement of account from ${companyName}.\n\nKind regards,\n${companyName}`
  );
  return `mailto:${to || ''}?subject=${subject}&body=${body}`;
}

export default function StatementPrint() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [statement, setStatement] = useState(null);
  const [company, setCompany] = useState(null);

  useEffect(() => {
    Promise.all([api.getStatementOfAccount(id), api.getCompany()]).then(([s, c]) => {
      setStatement(s);
      setCompany(c.company);
    });
  }, [id]);

  if (!statement || !company) return <p style={{ maxWidth: 800, margin: '40px auto' }}>Loading...</p>;

  const { exhibitor, activities, totalOutstanding, creditBalance } = statement;
  const emailTo = exhibitor.billing_email || exhibitor.contact1_email || '';

  return (
    <div className="page" style={{ maxWidth: 800, margin: '40px auto' }}>
      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
        <button type="button" onClick={() => navigate(`/exhibitors/${id}`)}>Back</button>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href={buildMailto(emailTo, company.name, exhibitor.company_name)}>
            <button type="button" disabled={!emailTo} title={emailTo ? `Email to ${emailTo}` : 'No email on file for this exhibitor'}>
              Email Statement
            </button>
          </a>
          <button type="button" onClick={() => downloadPdf('pdf-doc', `Statement-${exhibitor.company_name}`)}>Download PDF</button>
          <button type="button" onClick={() => window.print()}>Print</button>
        </div>
      </div>

      <div id="pdf-doc">
        <LetterheadBand company={company} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <BrandLogo company={company} height={44} />
            <div style={{ fontSize: 20, fontWeight: 700, color: '#1B3A6B' }}>{company.name}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <h2 style={{ margin: 0 }}>STATEMENT OF ACCOUNT</h2>
            <div style={{ fontSize: 13 }}>As at {new Date().toISOString().slice(0, 10)}</div>
          </div>
        </div>

        <div style={{ marginBottom: 24 }}>
          <h4 style={{ marginBottom: 4 }}>To</h4>
          <div>{exhibitor.company_name}</div>
        </div>

        <table width="100%" cellPadding="6">
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #1B3A6B' }}>
              <th>Date</th><th>Description</th>
              <th style={{ textAlign: 'right' }}>Invoiced</th>
              <th style={{ textAlign: 'right' }}>Received</th>
              <th style={{ textAlign: 'right' }}>Balance</th>
            </tr>
          </thead>
          <tbody>
            {activities.map((a) => (
              <tr key={`${a.type}-${a.id}`} style={{ borderBottom: '1px solid #eee' }}>
                <td>{a.date || '—'}</td>
                <td>{a.label}</td>
                <td style={{ textAlign: 'right' }}>{a.debit > 0 ? fmtMYR(a.debit) : '—'}</td>
                <td style={{ textAlign: 'right' }}>{a.credit > 0 ? fmtMYR(a.credit) : '—'}</td>
                <td style={{ textAlign: 'right' }}>{fmtBalance(a.balance)}</td>
              </tr>
            ))}
            {activities.length === 0 && <tr><td colSpan={5}>No activity yet.</td></tr>}
          </tbody>
        </table>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 32, marginTop: 16, fontSize: 15 }}>
          {creditBalance > 0.01 && (
            <div><strong>Available Credit:</strong> {fmtMYR(creditBalance)}</div>
          )}
          <div style={{ fontWeight: 700 }}><strong>Total Outstanding:</strong> {fmtBalance(totalOutstanding)}</div>
        </div>
        <FooterBand company={company} />
      </div>
    </div>
  );
}
