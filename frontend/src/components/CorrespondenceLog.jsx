import { useEffect, useState } from 'react';
import { api } from '../api/client';

// Real append-only history — every save ADDS an entry, nothing is ever
// overwritten. Shared by the Opportunity detail page and the Invoice detail
// page (see correspondence.controller.js); each entity_type/entity_id pair
// gets its own independent timeline.
export default function CorrespondenceLog({ entityType, entityId }) {
  const [entries, setEntries] = useState([]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  function load() {
    if (!entityId) return;
    api.listCorrespondence(entityType, entityId).then(({ entries }) => setEntries(entries));
  }

  useEffect(load, [entityType, entityId]);

  async function handleAdd(e) {
    e.preventDefault();
    if (!note.trim()) return;
    setSaving(true);
    setError('');
    try {
      await api.addCorrespondence(entityType, entityId, note);
      setNote('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function startEdit(e) {
    setEditingId(e.id);
    setEditText(e.note);
  }

  async function handleSaveEdit(id) {
    if (!editText.trim()) return;
    setSavingEdit(true);
    setError('');
    try {
      await api.updateCorrespondence(id, editText);
      setEditingId(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingEdit(false);
    }
  }

  if (!entityId) return null;

  return (
    <div style={{ marginTop: 32 }}>
      <h3>Correspondence</h3>
      <p style={{ fontSize: 13, color: '#5c6070' }}>A running log of calls, emails and follow-up actions — each entry is added, never overwritten.</p>
      <form onSubmit={handleAdd} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          style={{ flex: 1, padding: 8 }} placeholder="Add a note — call, email, feedback..."
          value={note} onChange={(e) => setNote(e.target.value)}
        />
        <button type="submit" disabled={saving || !note.trim()}>{saving ? 'Adding...' : 'Add'}</button>
      </form>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {entries.length === 0 ? (
        <p style={{ fontSize: 13, color: '#5c6070' }}>No correspondence recorded yet.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {entries.map((e) => (
            <li key={e.id} style={{ borderBottom: '1px solid #eee', padding: '8px 0' }}>
              <div style={{ fontSize: 12, color: '#5c6070', display: 'flex', justifyContent: 'space-between' }}>
                <span>
                  {new Date(e.created_at).toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' })} · {e.created_by_name || '—'}
                  {e.edited_at && (
                    <> · <em>edited {new Date(e.edited_at).toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' })}{e.edited_by_name ? ` by ${e.edited_by_name}` : ''}</em></>
                  )}
                </span>
                {editingId !== e.id && (
                  <button type="button" onClick={() => startEdit(e)} style={{ fontSize: 12, padding: '2px 8px' }}>Edit</button>
                )}
              </div>
              {editingId === e.id ? (
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <input
                    style={{ flex: 1, padding: 6 }} value={editText} onChange={(ev) => setEditText(ev.target.value)}
                    autoFocus
                  />
                  <button type="button" disabled={savingEdit || !editText.trim()} onClick={() => handleSaveEdit(e.id)}>
                    {savingEdit ? 'Saving...' : 'Save'}
                  </button>
                  <button type="button" onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              ) : (
                <div>{e.note}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
