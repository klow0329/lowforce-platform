import { NavLink } from 'react-router-dom';
import { useEventContext } from '../context/EventContext';

// Navy top bar with the ExpoCO logo — palette per checkpoint doc Section 6.
const linkStyle = ({ isActive }) => ({
  marginRight: 16,
  textDecoration: 'none',
  fontWeight: isActive ? 700 : 400,
  color: isActive ? '#F47920' : '#fff',
});

export default function NavBar({ user, onLogout }) {
  const { events, selectedEventId, setSelectedEventId, loading } = useEventContext();

  return (
    <div className="no-print" style={{ background: '#1B3A6B' }}>
      <div
        className="nav-inner"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          rowGap: 8,
          padding: '10px 24px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', rowGap: 6 }}>
          <img
            src="/logo.png"
            alt="ExpoCO"
            style={{ height: 34, marginRight: 20, background: '#fff', borderRadius: 6, padding: '2px 6px' }}
          />
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
              {events.filter((ev) => !ev.parent_event_id).map((ev) => (
                <option key={ev.id} value={ev.id}>{ev.name}</option>
              ))}
            </select>
          )}
          <NavLink to="/change-password" title="Change password" style={{ fontSize: 13, color: '#fff' }}>
            {user.full_name}
          </NavLink>
          <button onClick={onLogout}>Log out</button>
        </div>
      </div>
    </div>
  );
}
