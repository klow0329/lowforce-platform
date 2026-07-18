import { useEffect, useState } from 'react';
import { api } from '../api/client';

const label = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, marginTop: 12 };
const inputStyle = { display: 'block', width: '100%', padding: 8, boxSizing: 'border-box' };
const section = { marginBottom: 40 };

const emptyUserForm = { email: '', full_name: '', role_id: '', temp_password: '' };
const emptyEventForm = { id: null, code: '', name: '', event_year: '', start_date: '', end_date: '', parent_event_id: '' };

export default function Admin({ user }) {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [events, setEvents] = useState([]);
  const [userForm, setUserForm] = useState(emptyUserForm);
  const [showUserForm, setShowUserForm] = useState(false);
  const [eventForm, setEventForm] = useState(emptyEventForm);
  const [showEventForm, setShowEventForm] = useState(false);
  const [error, setError] = useState('');

  function loadAll() {
    api.adminListUsers().then(({ users }) => setUsers(users));
    api.adminListEvents().then(({ events }) => setEvents(events));
  }

  useEffect(() => {
    loadAll();
    api.adminListRoles().then(({ roles }) => setRoles(roles));
  }, []);

  // --- Users ---------------------------------------------------------------

  async function handleCreateUser(e) {
    e.preventDefault();
    setError('');
    if (!window.confirm(`Create user ${userForm.full_name} (${userForm.email})?`)) return;
    try {
      await api.adminCreateUser(userForm);
      setUserForm(emptyUserForm);
      setShowUserForm(false);
      loadAll();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRoleChange(u, roleId) {
    setError('');
    try {
      await api.adminUpdateUser(u.id, { role_id: roleId });
      loadAll();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleToggleActive(u) {
    setError('');
    if (!window.confirm(`${u.is_active ? 'Deactivate' : 'Activate'} ${u.full_name}?`)) return;
    try {
      await api.adminUpdateUser(u.id, { is_active: !u.is_active });
      loadAll();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleResetPassword(u) {
    const newPassword = window.prompt(`New temporary password for ${u.full_name} (min 8 characters):`);
    if (!newPassword) return;
    setError('');
    try {
      await api.adminResetPassword(u.id, { new_password: newPassword });
      window.alert(`Password reset. Tell ${u.full_name} to log in with it and change it.`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleToggleEventAccess(u, eventId) {
    setError('');
    const next = u.event_ids.includes(eventId)
      ? u.event_ids.filter((id) => id !== eventId)
      : [...u.event_ids, eventId];
    try {
      await api.adminSetUserEvents(u.id, { event_ids: next });
      loadAll();
    } catch (err) {
      setError(err.message);
    }
  }

  // --- Events ----------------------------------------------------------------

  function startEditEvent(ev) {
    setEventForm({
      id: ev.id,
      code: ev.code,
      name: ev.name,
      event_year: ev.event_year ?? '',
      start_date: ev.start_date || '',
      end_date: ev.end_date || '',
      parent_event_id: ev.parent_event_id || '',
    });
    setShowEventForm(true);
  }

  async function handleSaveEvent(e) {
    e.preventDefault();
    setError('');
    if (!window.confirm(eventForm.id ? `Save changes to event ${eventForm.code}?` : `Create event ${eventForm.code}?`)) return;
    try {
      if (eventForm.id) {
        const { id, code, ...payload } = eventForm;
        await api.adminUpdateEvent(id, payload);
      } else {
        await api.adminCreateEvent(eventForm);
      }
      setEventForm(emptyEventForm);
      setShowEventForm(false);
      loadAll();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleToggleEventActive(ev) {
    setError('');
    if (!window.confirm(`${ev.is_active ? 'Deactivate' : 'Activate'} event ${ev.code}?`)) return;
    try {
      await api.adminUpdateEvent(ev.id, { is_active: !ev.is_active });
      loadAll();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="page" style={{ maxWidth: 900, margin: '40px auto' }}>
      <h2>Admin</h2>
      {error && <p style={{ color: 'red' }}>{error}</p>}

      <div style={section}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>Users</h3>
          <button onClick={() => { setUserForm(emptyUserForm); setShowUserForm(!showUserForm); }}>
            {showUserForm ? 'Cancel' : '+ Add User'}
          </button>
        </div>

        {showUserForm && (
          <form onSubmit={handleCreateUser} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <label style={label}>Full Name</label>
            <input style={inputStyle} value={userForm.full_name} onChange={(e) => setUserForm({ ...userForm, full_name: e.target.value })} required />
            <label style={label}>Email</label>
            <input type="email" style={inputStyle} value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} required />
            <label style={label}>Role</label>
            <select style={inputStyle} value={userForm.role_id} onChange={(e) => setUserForm({ ...userForm, role_id: e.target.value })} required>
              <option value="">— Select —</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <label style={label}>Temporary Password (min 8 characters — the user should change it after first login)</label>
            <input style={inputStyle} value={userForm.temp_password} onChange={(e) => setUserForm({ ...userForm, temp_password: e.target.value })} required />
            <button type="submit" style={{ padding: '8px 16px', marginTop: 16 }}>Create User</button>
          </form>
        )}

        <table width="100%" cellPadding="6">
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Event Access</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={{ borderBottom: '1px solid #eee', opacity: u.is_active ? 1 : 0.5 }}>
                <td>{u.full_name}{u.id === user.id ? ' (you)' : ''}</td>
                <td>{u.email}</td>
                <td>
                  <select value={u.role_id || ''} onChange={(e) => handleRoleChange(u, e.target.value)}>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </td>
                <td>
                  {['ADM', 'MGT'].includes(u.role_code) ? (
                    <span style={{ fontSize: 12, color: '#5c6070' }}>All events</span>
                  ) : (
                    // Access is granted at main-event level — a grant covers
                    // the main event and all of its sub-events.
                    events.filter((ev) => !ev.parent_event_id).map((ev) => (
                      <label key={ev.id} style={{ fontSize: 12, marginRight: 8, whiteSpace: 'nowrap' }}>
                        <input
                          type="checkbox"
                          checked={u.event_ids.includes(ev.id)}
                          onChange={() => handleToggleEventAccess(u, ev.id)}
                        />
                        {' '}{ev.code}
                      </label>
                    ))
                  )}
                </td>
                <td>{u.is_active ? 'Active' : 'Inactive'}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button onClick={() => handleResetPassword(u)}>Reset Password</button>{' '}
                  {u.id !== user.id && (
                    <button onClick={() => handleToggleActive(u)}>{u.is_active ? 'Deactivate' : 'Activate'}</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={section}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>Events</h3>
          <button onClick={() => { setEventForm(emptyEventForm); setShowEventForm(!showEventForm); }}>
            {showEventForm ? 'Cancel' : '+ Add Event'}
          </button>
        </div>

        {showEventForm && (
          <form onSubmit={handleSaveEvent} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <label style={label}>Code (short, e.g. MIFB27 — can't be changed later)</label>
            <input style={inputStyle} value={eventForm.code} onChange={(e) => setEventForm({ ...eventForm, code: e.target.value })} required disabled={!!eventForm.id} />
            <label style={label}>Name</label>
            <input style={inputStyle} value={eventForm.name} onChange={(e) => setEventForm({ ...eventForm, name: e.target.value })} required />
            <label style={label}>Year</label>
            <input type="number" style={inputStyle} value={eventForm.event_year} onChange={(e) => setEventForm({ ...eventForm, event_year: e.target.value })} />
            <label style={label}>Start Date</label>
            <input type="date" style={inputStyle} value={eventForm.start_date} onChange={(e) => setEventForm({ ...eventForm, start_date: e.target.value })} />
            <label style={label}>End Date</label>
            <input type="date" style={inputStyle} value={eventForm.end_date} onChange={(e) => setEventForm({ ...eventForm, end_date: e.target.value })} />
            <label style={label}>Sub-event of (optional — e.g. MYFT/MCE under MIFB)</label>
            <select style={inputStyle} value={eventForm.parent_event_id} onChange={(e) => setEventForm({ ...eventForm, parent_event_id: e.target.value })}>
              <option value="">— None (main event) —</option>
              {events.filter((ev) => ev.id !== eventForm.id && !ev.parent_event_id).map((ev) => (
                <option key={ev.id} value={ev.id}>{ev.name}</option>
              ))}
            </select>
            <button type="submit" style={{ padding: '8px 16px', marginTop: 16 }}>
              {eventForm.id ? 'Save Changes' : 'Create Event'}
            </button>
          </form>
        )}

        <table width="100%" cellPadding="6">
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
              <th>Code</th>
              <th>Name</th>
              <th>Year</th>
              <th>Dates</th>
              <th>Type</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {events
              .filter((ev) => !ev.parent_event_id)
              .flatMap((main) => [main, ...events.filter((ev) => ev.parent_event_id === main.id)])
              .map((ev) => (
              <tr key={ev.id} style={{ borderBottom: '1px solid #eee', opacity: ev.is_active ? 1 : 0.5 }}>
                <td style={ev.parent_event_id ? { paddingLeft: 28 } : { fontWeight: 600 }}>
                  {ev.parent_event_id ? '↳ ' : ''}{ev.code}
                </td>
                <td>{ev.name}</td>
                <td>{ev.event_year || '—'}</td>
                <td>{ev.start_date && ev.end_date ? `${ev.start_date} → ${ev.end_date}` : '—'}</td>
                <td>{ev.parent_event_id ? `Sub-event of ${ev.parent_code}` : 'Main'}</td>
                <td>{ev.is_active ? 'Active' : 'Inactive'}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button onClick={() => startEditEvent(ev)}>Edit</button>{' '}
                  <button onClick={() => handleToggleEventActive(ev)}>{ev.is_active ? 'Deactivate' : 'Activate'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontSize: 12, color: '#5c6070' }}>
          The event dropdown in the top bar picks up event changes on the next page reload.
        </p>
      </div>
    </div>
  );
}
