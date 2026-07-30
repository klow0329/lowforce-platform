import { useState } from 'react';
import { api } from '../api/client';

// Admin-only reversible delete — archives the record (hidden everywhere,
// but recoverable) rather than truly destroying it. Blocked server-side
// with a clear reason if something else still depends on it (see
// archive.controller.js). Dropped onto each of the six record types this
// applies to; `onDeleted` decides where the page goes afterward.
export default function DeleteRecordButton({ type, id, label, onDeleted }) {
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    const reason = window.prompt(`Delete this ${label}? It will disappear everywhere but can be restored later from Admin > Archived Records. Reason for deleting:`);
    if (reason === null) return;
    if (!reason.trim()) { window.alert('A reason is required.'); return; }
    setBusy(true);
    try {
      await api.archiveRecord(type, id, reason.trim());
      onDeleted();
    } catch (err) {
      window.alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={handleDelete} disabled={busy} style={{ padding: '8px 16px', color: '#B23A3A' }}>
      {busy ? 'Deleting...' : 'Delete'}
    </button>
  );
}
