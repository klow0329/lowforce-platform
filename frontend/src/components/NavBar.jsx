import { useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { useEventContext } from '../context/EventContext';
import { confirmDiscardIfDirty } from '../utils/unsavedChanges';
import { BrandLogo } from './CompanyBranding';

// Navy top bar — logo is the logged-in tenant's own upload, or the neutral
// LowForce default until they set one up in Admin > Company Profile (see
// BrandLogo). Palette per checkpoint doc Section 6.
const linkStyle = ({ isActive }) => ({
  marginRight: 16,
  textDecoration: 'none',
  fontWeight: isActive ? 700 : 400,
  color: isActive ? '#F47920' : '#fff',
});

export default function NavBar({ user, company, onLogout, availableRoles = [], onSwitchRole }) {
  const { events, selectedEventId, setSelectedEventId, loading } = useEventContext();
  const navRef = useRef(null);

  // Every top-nav link is a "go to another screen" action — the exact case
  // the user asked to be warned about when leaving an Opportunity/Contract
  // with unsaved edits. Blocks the click (not just warns after the fact)
  // when the page currently mounted has reported unsaved changes.
  const guardNav = (e) => { if (!confirmDiscardIfDirty()) e.preventDefault(); };

  // The bar is frozen at the top ("freeze pane"); its measured height is
  // published as --nav-height so page sub-menus can stick directly beneath
  // it — the bar wraps to 2 lines on narrow screens, so the height varies.
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const setH = () => document.documentElement.style.setProperty('--nav-height', `${el.offsetHeight}px`);
    setH();
    const ro = new ResizeObserver(setH);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={navRef} className="no-print" style={{ background: '#1B3A6B', position: 'sticky', top: 0, zIndex: 100 }}>
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
          <BrandLogo
            company={company}
            height={34}
            style={{ marginRight: 20, background: '#fff', borderRadius: 6, padding: '2px 6px' }}
          />
          <NavLink to="/dashboard" style={linkStyle} onClick={guardNav}>Dashboard</NavLink>
          <NavLink to="/exhibitors" style={linkStyle} onClick={guardNav}>Exhibitors</NavLink>
          <NavLink to="/agents" style={linkStyle} onClick={guardNav}>Agents</NavLink>
          <NavLink to="/opportunities" style={linkStyle} onClick={guardNav}>Opportunities</NavLink>
          <NavLink to="/sales-orders" style={linkStyle} onClick={guardNav}>Contracts</NavLink>
          <NavLink to="/invoices" style={linkStyle} onClick={guardNav}>Invoices</NavLink>
          <NavLink to="/reports" style={linkStyle} onClick={guardNav}>Reports</NavLink>
          <NavLink to="/price-list" style={linkStyle} onClick={guardNav}>Price List</NavLink>
          <NavLink to="/floor-plan" style={linkStyle} onClick={guardNav}>Floor Plan</NavLink>
          {['ADM', 'MGT', 'FIN'].includes(user.role_code) && <NavLink to="/budget" style={linkStyle} onClick={guardNav}>Budget</NavLink>}
          {user.role_code === 'ADM' && <NavLink to="/admin" style={linkStyle} onClick={guardNav}>Admin</NavLink>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {!loading && events.length > 0 && (
            <select value={selectedEventId} onChange={(e) => setSelectedEventId(e.target.value)}>
              {events.filter((ev) => !ev.parent_event_id).map((ev) => (
                <option key={ev.id} value={ev.id}>{ev.name}</option>
              ))}
            </select>
          )}
          {availableRoles.length > 1 && (
            <select
              value={user.role_code}
              onChange={(e) => onSwitchRole(e.target.value)}
              title="Acting as"
            >
              {availableRoles.map((r) => (
                <option key={r.code} value={r.code}>Acting as: {r.name}</option>
              ))}
            </select>
          )}
          <NavLink to="/change-password" title="Change password" style={{ fontSize: 13, color: '#fff' }} onClick={guardNav}>
            {user.full_name}
          </NavLink>
          <button onClick={() => { if (confirmDiscardIfDirty()) onLogout(); }}>Log out</button>
        </div>
      </div>
    </div>
  );
}
