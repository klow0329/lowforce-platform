import { useEffect, useState } from 'react';

const inputStyle = { display: 'block', width: '100%', padding: 8, boxSizing: 'border-box', marginBottom: 12 };
const label = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 };

// PUBLIC page, no login — reached only via a one-time, expiring link a
// Sales/Admin user generated from the Exhibitor screen (see ExhibitorDetail.jsx's
// "Send Tax Detail Link"). Rendered directly by App.jsx before the login gate,
// since this visitor never has a LowForce account. The token in the URL is
// the only security — see taxDetailLinks.controller.js.
export default function TaxDetailForm() {
  const token = window.location.pathname.split('/').pop();
  const [status, setStatus] = useState('loading'); // loading | ready | error | submitted
  const [errorMsg, setErrorMsg] = useState('');
  const [context, setContext] = useState(null);
  const [form, setForm] = useState({
    company_name: '', reg_no: '', tin_no: '', address: '', postcode: '', city: '', state: '',
    email: '', contact_no: '', segment_main_id: '', segment_sub_id: '',
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`/api/tax-details/${token}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'This link is invalid.');
        return data;
      })
      .then((data) => {
        setContext(data);
        setForm((f) => ({ ...f, company_name: data.companyName || '' }));
        setStatus('ready');
      })
      .catch((err) => { setErrorMsg(err.message); setStatus('error'); });
  }, [token]);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function setDigitsOnly(field, value) {
    setForm((f) => ({ ...f, [field]: value.replace(/\D/g, '') }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg('');
    try {
      const res = await fetch(`/api/tax-details/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong — please try again.');
      setStatus('submitted');
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (status === 'loading') return <p style={{ maxWidth: 480, margin: '80px auto', textAlign: 'center' }}>Loading...</p>;

  if (status === 'error') {
    return (
      <div style={{ maxWidth: 480, margin: '80px auto', textAlign: 'center', padding: 16 }}>
        <h3>Link not available</h3>
        <p style={{ color: '#5c6070' }}>{errorMsg}</p>
      </div>
    );
  }

  if (status === 'submitted') {
    return (
      <div style={{ maxWidth: 480, margin: '80px auto', textAlign: 'center', padding: 16 }}>
        <h3>Thank you</h3>
        <p style={{ color: '#5c6070' }}>Your details have been received.</p>
      </div>
    );
  }

  const selectedMain = context?.segments?.find((s) => s.id === form.segment_main_id);

  return (
    <div style={{ maxWidth: 480, margin: '40px auto', padding: 16 }}>
      <h2>Company Tax &amp; Contact Details</h2>
      <p style={{ fontSize: 13, color: '#5c6070' }}>
        Please complete the details below so we can prepare your Contract correctly. This link can only be used once
        and will stop working after submission.
      </p>
      <form onSubmit={handleSubmit}>
        <label style={label}>Company Name *</label>
        <input style={inputStyle} value={form.company_name} onChange={(e) => set('company_name', e.target.value)} required />

        <label style={label}>New SSM No. (if Malaysian company)</label>
        <input style={inputStyle} value={form.reg_no} onChange={(e) => set('reg_no', e.target.value)} />

        <label style={label}>TIN No. (if Malaysian company)</label>
        <input style={inputStyle} value={form.tin_no} onChange={(e) => set('tin_no', e.target.value)} />

        <label style={label}>Company Address *</label>
        <input style={inputStyle} value={form.address} onChange={(e) => set('address', e.target.value)} required />

        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={label}>Postcode</label>
            <input style={inputStyle} value={form.postcode} onChange={(e) => setDigitsOnly('postcode', e.target.value)} inputMode="numeric" />
          </div>
          <div style={{ flex: 1 }}>
            <label style={label}>City</label>
            <input style={inputStyle} value={form.city} onChange={(e) => set('city', e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={label}>State</label>
            <input style={inputStyle} value={form.state} onChange={(e) => set('state', e.target.value)} />
          </div>
        </div>

        <label style={label}>Email *</label>
        <input type="email" style={inputStyle} value={form.email} onChange={(e) => set('email', e.target.value)} required />

        <label style={label}>Contact No. *</label>
        <input style={inputStyle} value={form.contact_no} onChange={(e) => setDigitsOnly('contact_no', e.target.value)} inputMode="numeric" placeholder="Country code first, e.g. 60123456789" required />

        {context?.segments?.length > 0 && (
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={label}>Business Segment (optional)</label>
              <select
                style={inputStyle} value={form.segment_main_id}
                onChange={(e) => setForm((f) => ({ ...f, segment_main_id: e.target.value, segment_sub_id: '' }))}
              >
                <option value="">— Select —</option>
                {context.segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            {selectedMain?.subSegments?.length > 0 && (
              <div style={{ flex: 1 }}>
                <label style={label}>Sub-Segment (optional)</label>
                <select style={inputStyle} value={form.segment_sub_id} onChange={(e) => set('segment_sub_id', e.target.value)}>
                  <option value="">— Select —</option>
                  {selectedMain.subSegments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
          </div>
        )}

        {errorMsg && <p style={{ color: 'red' }}>{errorMsg}</p>}
        <button type="submit" disabled={submitting} style={{ padding: '8px 16px' }}>
          {submitting ? 'Submitting...' : 'Submit'}
        </button>
      </form>
    </div>
  );
}
