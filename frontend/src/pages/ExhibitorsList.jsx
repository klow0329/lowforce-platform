import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { exportToExcel } from '../utils/exportExcel';

export default function ExhibitorsList() {
  const [exhibitors, setExhibitors] = useState([]);
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.listExhibitors(search).then((data) => setExhibitors(data.exhibitors));
  }, [search]);

  function handleExport() {
    exportToExcel(
      exhibitors.map((ex) => ({
        'Exhibitor Name': ex.company_name,
        Country: ex.country_code || '',
        'Contact 1': ex.contact1_name || '',
        'Contact 1 Email': ex.contact1_email || '',
      })),
      'exhibitors',
      'Exhibitors'
    );
  }

  return (
    <div className="page" style={{ maxWidth: 700, margin: '40px auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2>Exhibitors</h2>
        <button onClick={handleExport}>Export to Excel</button>
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
      <table className="responsive" width="100%" cellPadding="6">
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
            <th>Company</th>
            <th>Country</th>
            <th>Contact</th>
          </tr>
        </thead>
        <tbody>
          {exhibitors.map((ex) => (
            <tr
              key={ex.id}
              onClick={() => navigate(`/exhibitors/${ex.id}`)}
              style={{ borderBottom: '1px solid #eee', cursor: 'pointer' }}
            >
              <td data-label="Company">{ex.company_name}</td>
              <td data-label="Country">{ex.country_code || '—'}</td>
              <td data-label="Contact">{ex.contact1_name || 'No contact'}</td>
            </tr>
          ))}
          {exhibitors.length === 0 && (
            <tr><td colSpan={3}>No exhibitors yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
