import { useState } from 'react';

const inputStyle = { display: 'block', width: '100%', marginBottom: 8, padding: 8 };

// PUBLIC page, no login — reached via the "Forgot password?" link on the
// Login screen. Rendered directly by App.jsx before the login gate, same
// pattern as TaxDetailForm.jsx — raw fetch(), not the session-authenticated
// api client.
export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [companies, setCompanies] = useState(null); // set only if this email has more than one active company
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function attempt(companyId) {
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, company_id: companyId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong.');
      if (data.requiresCompanySelection) {
        setCompanies(data.companies);
      } else {
        setSent(true);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div style={{ maxWidth: 340, margin: '80px auto' }}>
        <img src="/lowforce-logo.png" alt="LowForce" style={{ display: 'block', width: 180, maxWidth: '100%', margin: '0 auto 16px' }} />
        <p style={{ fontSize: 14 }}>If that email has an account, a password reset link has been sent to it.</p>
        <p style={{ fontSize: 13, color: '#5c6070' }}>The link expires in 60 minutes and can only be used once.</p>
        <a href="/" style={{ display: 'block', textAlign: 'center', marginTop: 16 }}>Back to login</a>
      </div>
    );
  }

  if (companies) {
    return (
      <div style={{ maxWidth: 340, margin: '80px auto' }}>
        <img src="/lowforce-logo.png" alt="LowForce" style={{ display: 'block', width: 180, maxWidth: '100%', margin: '0 auto 16px' }} />
        <p style={{ fontSize: 14, color: '#5c6070' }}>{email} is linked to more than one company — choose which one.</p>
        {companies.map((c) => (
          <button
            key={c.id} type="button" onClick={() => attempt(c.id)} disabled={submitting}
            style={{ display: 'block', width: '100%', marginBottom: 8, padding: 10, textAlign: 'left' }}
          >
            {c.name}
          </button>
        ))}
        {error && <p style={{ color: 'red' }}>{error}</p>}
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); attempt(undefined); }}
      style={{ maxWidth: 340, margin: '80px auto' }}
    >
      <img src="/lowforce-logo.png" alt="LowForce" style={{ display: 'block', width: 180, maxWidth: '100%', margin: '0 auto 16px' }} />
      <p style={{ fontSize: 14, color: '#5c6070' }}>Enter your email and we'll send you a link to reset your password.</p>
      <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} required />
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <button type="submit" disabled={submitting} style={{ width: '100%', padding: 8 }}>
        {submitting ? 'Sending...' : 'Send Reset Link'}
      </button>
      <a href="/" style={{ display: 'block', textAlign: 'center', marginTop: 12, fontSize: 13 }}>Back to login</a>
    </form>
  );
}
