import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';

export default function ExhibitorsList() {
  const [exhibitors, setExhibitors] = useState([]);
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.listExhibitors(search).then((data) => setExhibitors(data.exhibitors));
  }, [search]);

  return (
    <div style={{ maxWidth: 700, margin: '40px auto' }}>
      <h2>Exhibitors</h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          placeholder="Search company name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, padding: 8 }}
        />
        <button onClick={() => navigate('/exhibitors/new')}>+ Add Exhibitor</button>
      </div>
      <table width="100%" cellPadding="6">
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
              <td>{ex.company_name}</td>
              <td>{ex.country_code || '—'}</td>
              <td>{ex.contact1_name || 'No contact'}</td>
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
