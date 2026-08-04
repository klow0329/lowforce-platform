import { useState } from 'react';
import { api } from '../api/client';

export default function Login({ onLoggedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  // Set only when this email has more than one active company account —
  // the person picks one, then we resubmit with that company_id.
  const [companies, setCompanies] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function attemptLogin(companyId) {
    setError('');
    setSubmitting(true);
    try {
      const result = await api.login(email, password, companyId);
      if (result.requiresCompanySelection) {
        setCompanies(result.companies);
      } else {
        onLoggedIn(result.user, result.availableRoles);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    attemptLogin(undefined);
  }

  if (companies) {
    return (
      <div style={{ maxWidth: 320, margin: '80px auto' }}>
        <img src="/lowforce-logo.png" alt="LowForce" style={{ display: "block", width: 180, maxWidth: "100%", margin: "0 auto 16px" }} />
        <p style={{ fontSize: 14, color: '#5c6070' }}>
          {email} is linked to more than one company — choose which one to log into.
        </p>
        {companies.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => attemptLogin(c.id)}
            disabled={submitting}
            style={{ display: 'block', width: '100%', marginBottom: 8, padding: 10, textAlign: 'left' }}
          >
            {c.name}
          </button>
        ))}
        {error && <p style={{ color: 'red' }}>{error}</p>}
        <button
          type="button"
          onClick={() => { setCompanies(null); setError(''); }}
          style={{ width: '100%', padding: 8, marginTop: 8, background: 'none', border: '1px solid #ccc' }}
        >
          Back
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 320, margin: '80px auto' }}>
      <img src="/lowforce-logo.png" alt="LowForce" style={{ display: "block", width: 180, maxWidth: "100%", margin: "0 auto 16px" }} />
      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{ display: 'block', width: '100%', marginBottom: 8, padding: 8 }}
      />
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        style={{ display: 'block', width: '100%', marginBottom: 8, padding: 8 }}
      />
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <button type="submit" disabled={submitting} style={{ width: '100%', padding: 8 }}>
        {submitting ? 'Logging in...' : 'Log in'}
      </button>
    </form>
  );
}
