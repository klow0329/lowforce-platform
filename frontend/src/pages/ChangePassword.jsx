import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';

const label = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, marginTop: 12 };
const inputStyle = { display: 'block', width: '100%', padding: 8, boxSizing: 'border-box' };

export default function ChangePassword() {
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (next.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (next !== confirm) {
      setError('New password and confirmation do not match.');
      return;
    }

    setSaving(true);
    try {
      await api.changePassword({ current_password: current, new_password: next });
      setDone(true);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  if (done) {
    return (
      <div className="page" style={{ maxWidth: 400, margin: '40px auto' }}>
        <h2>Password changed</h2>
        <p>Your password has been updated. Use the new one next time you log in.</p>
        <button onClick={() => navigate('/dashboard')} style={{ padding: '8px 16px' }}>Back to Dashboard</button>
      </div>
    );
  }

  return (
    <div className="page" style={{ maxWidth: 400, margin: '40px auto' }}>
      <h2>Change Password</h2>
      <form onSubmit={handleSubmit}>
        <label style={label}>Current Password</label>
        <input type="password" style={inputStyle} value={current} onChange={(e) => setCurrent(e.target.value)} required />

        <label style={label}>New Password (min 8 characters)</label>
        <input type="password" style={inputStyle} value={next} onChange={(e) => setNext(e.target.value)} required />

        <label style={label}>Confirm New Password</label>
        <input type="password" style={inputStyle} value={confirm} onChange={(e) => setConfirm(e.target.value)} required />

        {error && <p style={{ color: 'red' }}>{error}</p>}

        <button type="submit" disabled={saving} style={{ padding: '8px 16px', marginTop: 16 }}>
          {saving ? 'Saving...' : 'Change Password'}
        </button>
      </form>
    </div>
  );
}
