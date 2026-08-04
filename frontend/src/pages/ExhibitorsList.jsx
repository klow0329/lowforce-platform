import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useEventContext } from '../context/EventContext';
import DataTable from '../components/DataTable';

// "Salesperson" is the owner FOR THE CURRENTLY SELECTED EVENT (per-event
// ownership, migration 078) — the same exhibitor can be one rep's under
// MIFB and another's under AgriFood. "Events" shows every event the
// exhibitor takes part in, which is what makes a cross-event duplicate
// obvious during a search.
const columns = [
  { key: 'company_name', label: 'Company', default: true },
  { key: 'country_code', label: 'Country', default: true },
  { key: 'contact1_name', label: 'Contact', default: true, value: (r) => r.contact1_name || 'No contact' },
  { key: 'contact1_email', label: 'Contact Email', default: false },
  { key: 'contact1_phone', label: 'Contact Phone', default: false },
  { key: 'salesperson_name', label: 'Salesperson', default: true, value: (r) => r.salesperson_name || 'Unassigned' },
  { key: 'event_codes', label: 'Events', default: true, value: (r) => r.event_codes || '—' },
];

export default function ExhibitorsList({ user }) {
  const { selectedEventId, events } = useEventContext();
  const [exhibitors, setExhibitors] = useState([]);
  const [search, setSearch] = useState('');
  const [claiming, setClaiming] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const isElevated = ['ADM', 'MGT'].includes(user?.role_code);
  const selectedEvent = events?.find((ev) => ev.id === selectedEventId);

  function load() {
    api.listExhibitors(search, selectedEventId).then((data) => setExhibitors(data.exhibitors));
  }

  useEffect(() => {
    if (!selectedEventId) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, selectedEventId]);

  // A non-elevated Sales user can only open exhibitors they own — a search
  // also surfaces matches owned by another rep (see listExhibitors) so a
  // duplicate is never invisible, but those rows are view-only here: proof
  // it already exists, not something to click into.
  function ownedByOther(r) {
    return !isElevated && r.salesperson_id && r.salesperson_id !== user?.id;
  }

  // Not in the selected event yet — the cross-event handover case. Claiming
  // adds this event's participation row and assigns it to you, without
  // touching whoever owns it in any other event.
  function claimable(r) {
    return !r.in_selected_event && !!selectedEventId;
  }

  async function handleClaim(r) {
    setClaiming(r.id);
    setError('');
    setNotice('');
    try {
      await api.claimExhibitorForEvent(r.id, selectedEventId);
      setNotice(`"${r.company_name}" added to ${selectedEvent?.name || 'this event'} and assigned to you.`);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setClaiming('');
    }
  }

  return (
    <div className="page" style={{ maxWidth: 900, margin: '40px auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2>Exhibitors</h2>
        {selectedEvent && (
          <span style={{ fontSize: 13, color: '#5c6070' }}>
            Showing assignments for <strong>{selectedEvent.name}</strong>
          </span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          placeholder="Search company name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, padding: 8, minWidth: 180 }}
        />
        <button
          onClick={() => navigate('/exhibitors/new')}
          disabled={!search.trim()}
          title={search.trim() ? undefined : 'Search for the company name first, to make sure it isn’t already in the system'}
        >
          + Add Exhibitor
        </button>
      </div>
      {!search.trim() && (
        <p style={{ fontSize: 12, color: '#5c6070', marginTop: -10 }}>
          Search for the exhibitor's company name above before adding a new one — it also checks other salespeople's
          accounts and other events, so you can catch a duplicate before creating one.
        </p>
      )}
      {notice && <p style={{ fontSize: 13, color: '#2a7a2a' }}>{notice}</p>}
      {error && <p style={{ fontSize: 13, color: '#B23A3A' }}>{error}</p>}
      <DataTable
        screenKey="exhibitors"
        columns={[
          ...columns,
          {
            key: 'claim',
            label: '',
            default: true,
            render: (r) => (claimable(r) ? (
              <button
                type="button"
                disabled={claiming === r.id}
                onClick={(e) => { e.stopPropagation(); handleClaim(r); }}
                style={{ fontSize: 12, padding: '3px 8px' }}
                title={`Add to ${selectedEvent?.name || 'this event'} and assign to me`}
              >
                {claiming === r.id ? 'Adding...' : 'Add to my event'}
              </button>
            ) : null),
          },
        ]}
        rows={exhibitors}
        getRowKey={(r) => r.id}
        onRowClick={(r) => { if (!ownedByOther(r)) navigate(`/exhibitors/${r.id}`); }}
        getRowStyle={(r) => (ownedByOther(r) ? { color: '#9099a8', cursor: 'default' } : null)}
        exportFilename="exhibitors"
        exportSheetName="Exhibitors"
      />
    </div>
  );
}
