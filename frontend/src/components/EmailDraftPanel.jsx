import { useEffect, useState } from 'react';
import { api } from '../api/client';

// {{token}} substitution — a token with no supplied value is left as
// literal text (visible on purpose, so it's obvious to fix rather than
// silently disappearing).
function fillTemplate(text, vars) {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => (key in vars ? vars[key] : match));
}

// A web page can't reach into Outlook to read your signature, set the
// compose font, or pick which mailbox sends — that needs a real Outlook/
// Microsoft 365 integration. Instead: the user opens a New Email in
// Outlook themselves first (so THEIR signature and account are used,
// exactly like any email they write), then copies the drafted Subject/
// Body from here and pastes it in. Wording comes from the company's own
// admin-configurable email_templates (see Admin > Email Templates).
export default function EmailDraftPanel({ templateKey, vars, onClose }) {
  const [template, setTemplate] = useState(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  useEffect(() => {
    api.getEmailTemplate(templateKey)
      .then(({ template }) => {
        setTemplate(template);
        setSubject(fillTemplate(template.subject, vars));
        setBody(fillTemplate(template.body, vars));
      })
      .catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateKey]);

  async function copyText(text, which) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(''), 2000);
    } catch {
      setError('Could not copy — please select and copy the text manually.');
    }
  }

  return (
    <div style={{ background: '#F5F6FA', border: '1px solid #ddd', borderRadius: 8, padding: 16, margin: '12px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h4 style={{ margin: 0 }}>Draft Email</h4>
        <button type="button" onClick={onClose}>Close</button>
      </div>
      <p style={{ fontSize: 12, color: '#5c6070' }}>
        1. Open <strong>New Email</strong> in Outlook yourself (so your own signature and account are used).{' '}
        2. Copy the Subject and Body below and paste them in.
      </p>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {!template && !error && <p>Loading template...</p>}
      {template && (
        <>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginTop: 8 }}>Subject</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={{ flex: 1, padding: 8 }} value={subject} onChange={(e) => setSubject(e.target.value)} />
            <button type="button" onClick={() => copyText(subject, 'subject')}>
              {copied === 'subject' ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginTop: 12 }}>Body</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <textarea style={{ flex: 1, padding: 8, minHeight: 160 }} value={body} onChange={(e) => setBody(e.target.value)} />
            <button type="button" onClick={() => copyText(body, 'body')} style={{ alignSelf: 'flex-start' }}>
              {copied === 'body' ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
