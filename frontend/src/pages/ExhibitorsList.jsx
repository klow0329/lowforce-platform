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
];

export default function ExhibitorsList() {
  const [exhibitors, setExhibitors] = useState([]);
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.listExhibitors(search).then((data) => setExhibitors(data.exhibitors));
  }, [search]);

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
        <button onClick={() => navigate('/exhibitors/new')}>+ Add Exhibitor</button>
      </div>
      <DataTable
        screenKey="exhibitors"
        columns={columns}
        rows={exhibitors}
        getRowKey={(r) => r.id}
        onRowClick={(r) => navigate(`/exhibitors/${r.id}`)}
        exportFilename="exhibitors"
        exportSheetName="Exhibitors"
      />
    </div>
  );
}
