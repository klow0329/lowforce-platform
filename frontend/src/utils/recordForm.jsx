// Shared helpers for the view-first record pattern: records open read-only,
// "Edit" enables changes, changed values are listed before saving, and
// saving always asks for confirmation (protects against slip-of-the-hand
// edits — applied across every record form per user request).

const norm = (v) =>
  v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);

const prettyLabel = (key) =>
  key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const display = (v) => {
  if (v === null || v === undefined || v === '') return '(empty)';
  if (typeof v === 'object') return '(updated)';
  return String(v).length > 45 ? String(v).slice(0, 45) + '…' : String(v);
};

// Compares the loaded snapshot to the current form values.
export function computeChanges(original, form, labelMap = {}) {
  if (!original) return [];
  const changes = [];
  for (const key of Object.keys(form)) {
    if (norm(original[key]) !== norm(form[key])) {
      changes.push({
        field: key,
        label: labelMap[key] || prettyLabel(key),
        from: display(original[key]),
        to: display(form[key]),
      });
    }
  }
  return changes;
}

// Confirmation dialog before any save. Returns false if the user cancels.
export function confirmSave(changes, entityName, isNew) {
  if (isNew) {
    return window.confirm(`Create this ${entityName}?`);
  }
  if (changes.length === 0) {
    return window.confirm(`No values were changed. Save anyway?`);
  }
  const lines = changes.slice(0, 12).map((c) => `• ${c.label}: ${c.from} → ${c.to}`);
  if (changes.length > 12) lines.push(`…and ${changes.length - 12} more change(s)`);
  return window.confirm(`Save these changes?\n\n${lines.join('\n')}`);
}

// Yellow banner listing what changed, shown while editing an existing record.
export function ChangesBanner({ changes }) {
  if (!changes.length) return null;
  return (
    <div style={{ background: '#FFF3BF', border: '1px solid #F0C36D', borderRadius: 8, padding: '8px 12px', margin: '12px 0', fontSize: 13 }}>
      <strong>Changed values:</strong>
      <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
        {changes.map((c) => (
          <li key={c.field}>{c.label}: <s style={{ color: '#8a6d1a' }}>{c.from}</s> → <strong>{c.to}</strong></li>
        ))}
      </ul>
    </div>
  );
}

export const fieldsetStyle = { border: 'none', padding: 0, margin: 0 };
