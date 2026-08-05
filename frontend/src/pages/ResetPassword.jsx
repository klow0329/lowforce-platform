import { useEffect, useState } from 'react';

const inputStyle = { display: 'block', width: '100%', marginBottom: 8, padding: 8 };

// PUBLIC page, no login — reached only via the one-time, expiring link
// emailed by "Forgot Password". Rendered directly by App.jsx before the
// login gate, same pattern as TaxDetailForm.jsx.
export default function ResetPassword() {
  const token = window.location.pathname.split('/').pop();
  const [status, setStatus] = useState('loading'); // loading | ready | error | done
  const [errorMsg, setErrorMsg] = useState('');
  const [email, setEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`/api/auth/reset-password/${token}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'This link is invalid.');
        return data;
      })
      .then((data) => { setEmail(data.email); setStatus('ready'); })
      .catch((err) => { setErrorMsg(err.message); setStatus('error'); });
  }, [token]);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitError('');
    if (newPassword !== confirm) { setSubmitError('New password and confirmation do not match.'); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/auth/reset-password/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_password: newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong.');
      setStatus('done');
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (status === 'loading') return <p style={{ maxWidth: 340, margin: '80px auto', textAlign: 'center' }}>Loading...</p>;

  if (status === 'error') {
    return (
      <div style={{ maxWidth: 340, margin: '80px auto' }}>
        <img src="/lowforce-logo.png" alt="LowForce" style={{ display: 'block', width: 180, maxWidth: '100%', margin: '0 auto 16px' }} />
        <p style={{ color: 'red' }}>{errorMsg}</p>
        <a href="/forgot-password" style={{ display: 'block', textAlign: 'center', marginTop: 16 }}>Request a new link</a>
      </div>
    );
  }

  if (status === 'done') {
    return (
      <div style={{ maxWidth: 340, margin: '80px auto' }}>
        <img src="/lowforce-logo.png" alt="LowForce" style={{ display: 'block', width: 180, maxWidth: '100%', margin: '0 auto 16px' }} />
        <p style={{ fontSize: 14 }}>Your password has been reset.</p>
        <a href="/" style={{ display: 'block', textAlign: 'center', marginTop: 16 }}>Log in</a>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 340, margin: '80px auto' }}>
      <img src="/lowforce-logo.png" alt="LowForce" style={{ display: 'block', width: 180, maxWidth: '100%', margin: '0 auto 16px' }} />
      <p style={{ fontSize: 14, color: '#5c6070' }}>Set a new password for {email}.</p>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>New password</label>
      <p style={{ fontSize: 12, color: '#5c6070', margin: '0 0 4px' }}>
        At least 8 characters, with an uppercase letter, a lowercase letter, a number, and a special character.
      </p>
      <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} style={inputStyle} required minLength={8} />
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Confirm new password</label>
      <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} style={inputStyle} required minLength={8} />
      {submitError && <p style={{ color: 'red' }}>{submitError}</p>}
      <button type="submit" disabled={submitting} style={{ width: '100%', padding: 8 }}>
        {submitting ? 'Saving...' : 'Reset Password'}
      </button>
    </form>
  );
}
