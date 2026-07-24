import { useNavigate } from 'react-router-dom';

const URGENCY_STYLE = {
  urgent: { bg: '#fdecec', fg: '#c83c3c', label: 'Urgent' },
  due: { bg: '#FFF3BF', fg: '#8a6d1a', label: 'Due Today' },
  soon: { bg: '#E3F2FD', fg: '#1B3A6B', label: 'Coming Soon' },
  // Not a deadline — a heads-up notification (e.g. "payment received"),
  // sorted last so real deadlines above it stay the priority.
  info: { bg: '#eafaf1', fg: '#1A9C5B', label: 'Received' },
};

const URGENCY_ORDER = { urgent: 0, due: 1, soon: 2, info: 3 };

// Shared "what needs my attention" box — Dashboard, Opportunities and
// Contracts each pass in their own slice of GET /reports/tasks so the
// urgency styling/sorting stays identical everywhere it appears.
// items: [{ key, urgency: 'urgent'|'due'|'soon'|'info', label, meta, href,
//           actions?: [{ label, onClick }] }]
// actions is optional — a small button per action, rendered instead of
// relying solely on the row click (e.g. "Acknowledge" without navigating
// away from the page you're already on).
export default function TaskToDoBox({ title, items, emptyText = 'Nothing pending.' }) {
  const navigate = useNavigate();
  const sorted = [...items].sort((a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency]);

  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 24 }}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      {sorted.length === 0 ? (
        <p style={{ fontSize: 13, color: '#5c6070' }}>{emptyText}</p>
      ) : (
        <table width="100%" cellPadding="6">
          <tbody>
            {sorted.map((it) => (
              <tr
                key={it.key}
                onClick={() => navigate(it.href)}
                style={{ cursor: 'pointer', borderBottom: '1px solid #eee' }}
              >
                <td style={{ width: 100 }}>
                  <span style={{
                    background: URGENCY_STYLE[it.urgency].bg, color: URGENCY_STYLE[it.urgency].fg,
                    padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
                  }}>
                    {URGENCY_STYLE[it.urgency].label}
                  </span>
                </td>
                <td>{it.label}</td>
                <td style={{ fontSize: 12, color: '#5c6070', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {it.meta}
                  {it.actions?.map((a) => (
                    <button
                      key={a.label}
                      type="button"
                      onClick={(e) => { e.stopPropagation(); a.onClick(); }}
                      style={{ marginLeft: 8, fontSize: 11, padding: '2px 8px' }}
                    >
                      {a.label}
                    </button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
