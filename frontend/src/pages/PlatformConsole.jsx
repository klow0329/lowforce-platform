import { useEffect, useState } from 'react';
import { platformApi } from '../api/client';

// The LowForce operator's own console — deliberately rendered OUTSIDE the
// tenant app shell (no NavBar, no EventContext, no company branding),
// because it isn't "inside" any company. Reached at /platform and
// authenticated by its own session; a logged-in tenant user hitting this
// URL simply sees the platform login, since their session carries no
// platform-admin key.
const box = { border: '1px solid #e2e5ec', borderRadius: 8, padding: 16, background: '#fff', marginBottom: 16 };
const label = { display: 'block', fontSize: 12, color: '#5c6070', marginBottom: 2, marginTop: 8 };
const input = { width: '100%', padding: 8, boxSizing: 'border-box' };
const th = { textAlign: 'left', borderBottom: '1px solid #e2e5ec', padding: '6px 8px', fontSize: 12, color: '#5c6070' };
const td = { padding: '6px 8px', borderBottom: '1px solid #f0f2f5', fontSize: 13 };

const emptyCompany = { name: '', reg_no: '', country_code: '', group_id: '', notes: '' };
const emptyGroup = { name: '', reg_no: '', country_code: '', parent_group_id: '', notes: '' };

export default function PlatformConsole() {
  const [admin, setAdmin] = useState(null);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [groups, setGroups] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [groupForm, setGroupForm] = useState(emptyGroup);
  const [companyForm, setCompanyForm] = useState(emptyCompany);
  const [adminFor, setAdminFor] = useState(null);
  const [adminForm, setAdminForm] = useState({ email: '', full_name: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    platformApi.me()
      .then(({ platformAdmin }) => setAdmin(platformAdmin))
      .catch(() => setAdmin(null))
      .finally(() => setChecking(false));
  }, []);

  function load() {
    platformApi.listGroups().then(({ groups }) => setGroups(groups)).catch((e) => setError(e.message));
    platformApi.listCompanies().then(({ companies }) => setCompanies(companies)).catch((e) => setError(e.message));
  }

  useEffect(() => { if (admin) load(); }, [admin]);

  async function handleLogin(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { platformAdmin } = await platformApi.login(email, password);
      setAdmin(platformAdmin);
      setPassword('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function run(fn, successMsg) {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await fn();
      if (successMsg) setNotice(successMsg);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (checking) return null;

  if (!admin) {
    return (
      <form onSubmit={handleLogin} style={{ maxWidth: 320, margin: '80px auto' }}>
        <img src="/lowforce-logo.png" alt="LowForce" style={{ display: 'block', width: 160, maxWidth: '100%', margin: '0 auto 8px' }} />
        <p style={{ textAlign: 'center', fontSize: 13, color: '#5c6070', marginTop: 0 }}>Platform Console</p>
        <input style={{ ...input, marginBottom: 8 }} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input style={{ ...input, marginBottom: 8 }} type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button type="submit" disabled={busy} style={{ width: '100%' }}>{busy ? 'Signing in...' : 'Sign in'}</button>
        {error && <p style={{ color: '#B23A3A', fontSize: 13 }}>{error}</p>}
      </form>
    );
  }

  return (
    <div className="page" style={{ maxWidth: 1000, margin: '30px auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src="/lowforce-logo.png" alt="LowForce" style={{ height: 34 }} />
          <div>
            <div style={{ fontWeight: 700 }}>Platform Console</div>
            <div style={{ fontSize: 12, color: '#5c6070' }}>{admin.full_name} · {admin.email}</div>
          </div>
        </div>
        <button type="button" onClick={() => platformApi.logout().then(() => setAdmin(null))}>Log out</button>
      </div>

      {error && <p style={{ color: '#B23A3A', fontSize: 13 }}>{error}</p>}
      {notice && <p style={{ color: '#2a7a2a', fontSize: 13 }}>{notice}</p>}

      <h3>Groups</h3>
      <div style={box}>
        <table width="100%" style={{ borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Group</th><th style={th}>Reg No</th><th style={th}>Parent</th><th style={th}>Companies</th></tr></thead>
          <tbody>
            {groups.length === 0 && <tr><td style={td} colSpan={4}>No groups yet.</td></tr>}
            {groups.map((g) => (
              <tr key={g.id}>
                <td style={td}>{g.name}</td>
                <td style={td}>{g.reg_no || '—'}</td>
                <td style={td}>{g.parent_group_name || '—'}</td>
                <td style={td}>{g.company_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={box}>
        <strong style={{ fontSize: 13 }}>Register a group</strong>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 200px' }}>
            <label style={label}>Group name *</label>
            <input style={input} value={groupForm.name} onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })} />
          </div>
          <div style={{ flex: '1 1 140px' }}>
            <label style={label}>Registration No</label>
            <input style={input} value={groupForm.reg_no} onChange={(e) => setGroupForm({ ...groupForm, reg_no: e.target.value })} />
          </div>
          <div style={{ flex: '1 1 140px' }}>
            <label style={label}>Parent group</label>
            <select style={input} value={groupForm.parent_group_id} onChange={(e) => setGroupForm({ ...groupForm, parent_group_id: e.target.value })}>
              <option value="">— None (top level) —</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
        </div>
        <button
          type="button" disabled={busy || !groupForm.name.trim()} style={{ marginTop: 10 }}
          onClick={() => run(() => platformApi.createGroup(groupForm).then(() => setGroupForm(emptyGroup)), 'Group registered.')}
        >
          Register Group
        </button>
      </div>

      <h3 style={{ marginTop: 28 }}>Companies (tenants)</h3>
      <div style={box}>
        <table width="100%" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Company</th><th style={th}>Reg No</th><th style={th}>Group</th>
              <th style={th}>Users</th><th style={th}>Events</th><th style={th}>Exhibitors</th><th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {companies.length === 0 && <tr><td style={td} colSpan={7}>No companies yet.</td></tr>}
            {companies.map((c) => (
              <tr key={c.id} style={c.is_active ? null : { opacity: 0.5 }}>
                <td style={td}>{c.name}</td>
                <td style={td}>{c.reg_no || '—'}</td>
                <td style={td}>
                  <select
                    style={{ ...input, padding: 4, fontSize: 12 }}
                    value={c.group_id || ''}
                    onChange={(e) => run(() => platformApi.updateCompany(c.id, { group_id: e.target.value || null }), 'Group link updated.')}
                  >
                    <option value="">— None —</option>
                    {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </td>
                <td style={td}>{c.user_count}</td>
                <td style={td}>{c.event_count}</td>
                <td style={td}>{c.exhibitor_count}</td>
                <td style={td}>
                  {Number(c.user_count) === 0 && (
                    <button type="button" style={{ fontSize: 12, padding: '3px 8px' }} onClick={() => { setAdminFor(c); setAdminForm({ email: '', full_name: '' }); }}>
                      Create first Admin
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {adminFor && (
        <div style={{ ...box, borderColor: '#185FA5' }}>
          <strong style={{ fontSize: 13 }}>First Admin for {adminFor.name}</strong>
          <p style={{ fontSize: 12, color: '#5c6070' }}>
            Creates this tenant&rsquo;s first Admin account and shows a one-time temporary password.
            Everyone else is added by that Admin from inside the company.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 200px' }}>
              <label style={label}>Email *</label>
              <input style={input} value={adminForm.email} onChange={(e) => setAdminForm({ ...adminForm, email: e.target.value })} />
            </div>
            <div style={{ flex: '1 1 200px' }}>
              <label style={label}>Full name *</label>
              <input style={input} value={adminForm.full_name} onChange={(e) => setAdminForm({ ...adminForm, full_name: e.target.value })} />
            </div>
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            <button
              type="button" disabled={busy || !adminForm.email.trim() || !adminForm.full_name.trim()}
              onClick={() => run(async () => {
                const { user } = await platformApi.createCompanyAdmin(adminFor.id, adminForm);
                window.alert(`Admin created for ${adminFor.name}\n\nEmail: ${user.email}\nTemporary password: ${user.temp_password}\n\nSave this now — it is not shown again.`);
                setAdminFor(null);
              })}
            >
              Create Admin
            </button>
            <button type="button" onClick={() => setAdminFor(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div style={box}>
        <strong style={{ fontSize: 13 }}>Register a company</strong>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 200px' }}>
            <label style={label}>Company name *</label>
            <input style={input} value={companyForm.name} onChange={(e) => setCompanyForm({ ...companyForm, name: e.target.value })} />
          </div>
          <div style={{ flex: '1 1 140px' }}>
            <label style={label}>Registration No</label>
            <input style={input} value={companyForm.reg_no} onChange={(e) => setCompanyForm({ ...companyForm, reg_no: e.target.value })} />
          </div>
          <div style={{ flex: '1 1 140px' }}>
            <label style={label}>Group</label>
            <select style={input} value={companyForm.group_id} onChange={(e) => setCompanyForm({ ...companyForm, group_id: e.target.value })}>
              <option value="">— Standalone —</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
        </div>
        <p style={{ fontSize: 12, color: '#5c6070', marginBottom: 0 }}>
          Registering also creates the starter setup every company needs — default roles, sales stages, aging buckets
          and settings — which the company then edits for itself.
        </p>
        <button
          type="button" disabled={busy || !companyForm.name.trim()} style={{ marginTop: 10 }}
          onClick={() => run(() => platformApi.createCompany(companyForm).then(() => setCompanyForm(emptyCompany)), 'Company registered.')}
        >
          Register Company
        </button>
      </div>
    </div>
  );
}
