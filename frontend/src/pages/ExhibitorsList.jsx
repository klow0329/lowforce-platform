import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import DataTable from '../components/DataTable';

const columns = [
  { key: 'company_name', label: 'Company', default: true },
  { key: 'country_code', label: 'Country', default: true },
  { key: 'contact1_name', label: 'Contact', default: true, value: (r) => r.contact1_name || 'No contact' },
  { key: 'contact1_email', label: 'Contact Email', default: false },
  { key: 'contact1_phone', label: 'Contact Phone', default: false },
  { key: 'salesperson_name', label: 'Salesperson', default: true, value: (r) => r.salesperson_name || 'Unassigned' },
];

export default function ExhibitorsList({ user }) {
  const [exhibitors, setExhibitors] = useState([]);
  const [search, setSearch] = useState('');
  const navigate = useNavigate();
  const isElevated = ['ADM', 'MGT'].includes(user?.role_code);

  useEffect(() => {
    api.listExhibitors(search).then((data) => setExhibitors(data.exhibitors));
  }, [search]);

  // A non-elevated Sales user can only open their own/unclaimed exhibitors —
  // a search now also surfaces matches owned by another rep (see
  // listExhibitors) so a duplicate is never invisible, but those rows are
  // view-only here: proof it already exists, not something to click into.
  function ownedByOther(r) {
    return !isElevated && r.salesperson_id && r.salesperson_id !== user?.id;
  }

  return (
    <div className="page" style={{ maxWidth: 900, margin: '40px auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2>Exhibitors</h2>
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
          Search for the exhibitor's company name above before adding a new one — it also checks other salespeople's accounts, so you can catch a duplicate before creating one.
        </p>
      )}
      <DataTable
        screenKey="exhibitors"
        columns={columns}
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
