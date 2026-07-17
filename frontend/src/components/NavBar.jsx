import { NavLink } from 'react-router-dom';
import { useEventContext } from '../context/EventContext';

const linkStyle = ({ isActive }) => ({
  marginRight: 16,
  textDecoration: 'none',
  fontWeight: isActive ? 700 : 400,
  color: isActive ? '#1B3A6B' : '#5c6070',
});

export default function NavBar({ user, onLogout }) {
  const { events, selectedEventId, setSelectedEventId, loading } = useEventContext();

  return (
    <div
      className="no-print"
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        maxWidth: 900,
        margin: '0 auto',
        padding: '16px 0',
        borderBottom: '1px solid #eee',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <NavLink to="/dashboard" style={linkStyle}>Dashboard</NavLink>
        <NavLink to="/exhibitors" style={linkStyle}>Exhibitors</NavLink>
        <NavLink to="/opportunities" style={linkStyle}>Opportunities</NavLink>
        <NavLink to="/sales-orders" style={linkStyle}>Contracts</NavLink>
        <NavLink to="/invoices" style={linkStyle}>Invoices</NavLink>
        <NavLink to="/customer-aging" style={linkStyle}>Aging</NavLink>
        <NavLink to="/price-list" style={linkStyle}>Price List</NavLink>
        {user.role_code === 'ADM' && <NavLink to="/admin" style={linkStyle}>Admin</NavLink>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {!loading && events.length > 0 && (
          <select value={selectedEventId} onChange={(e) => setSelectedEventId(e.target.value)}>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>{ev.name}</option>
            ))}
          </select>
        )}
        <NavLink to="/change-password" title="Change password" style={{ fontSize: 13, color: '#5c6070' }}>
          {user.full_name}
        </NavLink>
        <button onClick={onLogout}>Log out</button>
      </div>
    </div>
  );
}
