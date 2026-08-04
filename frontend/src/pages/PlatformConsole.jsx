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

const emptyCompany = { id: null, name: '', reg_no: '', country_code: '', group_id: '', notes: '' };
const emptyGroup = { id: null, name: '', reg_no: '', country_code: '', parent_group_id: '', notes: '' };

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
  const [usersFor, setUsersFor] = useState(null); // company object, or null when the panel is closed
  const [companyUsers, setCompanyUsers] = useState([]);
  const [adminForm, setAdminForm] = useState({ email: '', full_name: '' });
  const [editingUserId, setEditingUserId] = useState(null);
  const [userEditForm, setUserEditForm] = useState({ email: '', full_name: '' });
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [pwForm, setPwForm] = useState({ current_password: '', new_password: '', confirm: '' });
  const [audit, setAudit] = useState([]);
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
    platformApi.listAudit().then(({ entries }) => setAudit(entries)).catch(() => {});
  }

  useEffect(() => { if (admin) load(); }, [admin]);

  function openUsersFor(company) {
    setUsersFor(company);
    setAdminForm({ email: '', full_name: '' });
    setEditingUserId(null);
    platformApi.listCompanyUsers(company.id).then(({ users }) => setCompanyUsers(users)).catch((e) => setError(e.message));
  }

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
        <div>
          <button type="button" onClick={() => setShowChangePassword(!showChangePassword)} style={{ marginRight: 8 }}>
            {showChangePassword ? 'Cancel' : 'Change password'}
          </button>
          <button type="button" onClick={() => platformApi.logout().then(() => setAdmin(null))}>Log out</button>
        </div>
      </div>

      {showChangePassword && (
        <form
          style={{ ...box, borderColor: '#185FA5', maxWidth: 360 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (pwForm.new_password !== pwForm.confirm) { setError('New password and confirmation do not match.'); return; }
            run(async () => {
              await platformApi.changePassword(pwForm.current_password, pwForm.new_password);
              setPwForm({ current_password: '', new_password: '', confirm: '' });
              setShowChangePassword(false);
            }, 'Password changed.');
          }}
        >
          <strong style={{ fontSize: 13 }}>Change your password</strong>
          <p style={{ fontSize: 12, color: '#5c6070' }}>
            Forgot it entirely and can&rsquo;t log in to change it here? Re-run the bootstrap script with your same
            email — it resets the password (see backend/scripts/create-platform-admin.js).
          </p>
          <label style={label}>Current password</label>
          <input style={input} type="password" value={pwForm.current_password} onChange={(e) => setPwForm({ ...pwForm, current_password: e.target.value })} required />
          <label style={label}>New password</label>
          <input style={input} type="password" value={pwForm.new_password} onChange={(e) => setPwForm({ ...pwForm, new_password: e.target.value })} required minLength={8} />
          <label style={label}>Confirm new password</label>
          <input style={input} type="password" value={pwForm.confirm} onChange={(e) => setPwForm({ ...pwForm, confirm: e.target.value })} required minLength={8} />
          <button type="submit" disabled={busy} style={{ marginTop: 10 }}>Save new password</button>
        </form>
      )}

      {error && <p style={{ color: '#B23A3A', fontSize: 13 }}>{error}</p>}
      {notice && <p style={{ color: '#2a7a2a', fontSize: 13 }}>{notice}</p>}

      <h3>Groups</h3>
      <div style={box}>
        <table width="100%" style={{ borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Group</th><th style={th}>Reg No</th><th style={th}>Parent</th><th style={th}>Companies</th><th style={th}></th></tr></thead>
          <tbody>
            {groups.length === 0 && <tr><td style={td} colSpan={5}>No groups yet.</td></tr>}
            {groups.map((g) => (
              <tr key={g.id}>
                <td style={td}>{g.name}</td>
                <td style={td}>{g.reg_no || '—'}</td>
                <td style={td}>{g.parent_group_name || '—'}</td>
                <td style={td}>{g.company_count}</td>
                <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button
                    type="button" style={{ fontSize: 12, padding: '3px 8px' }}
                    onClick={() => setGroupForm({ id: g.id, name: g.name, reg_no: g.reg_no || '', country_code: g.country_code || '', parent_group_id: g.parent_group_id || '', notes: g.notes || '' })}
                  >
                    Edit
                  </button>{' '}
                  <button
                    type="button" style={{ fontSize: 12, padding: '3px 8px' }}
                    onClick={() => {
                      if (!window.confirm(`Delete group "${g.name}"? This only works if it has no companies and no child groups — otherwise it will be refused.`)) return;
                      run(() => platformApi.deleteGroup(g.id), `${g.name} deleted.`);
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={box}>
        <strong style={{ fontSize: 13 }}>{groupForm.id ? `Edit ${groupForm.name}` : 'Register a group'}</strong>
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
            <select style={input} value={groupForm.parent_group_id || ''} onChange={(e) => setGroupForm({ ...groupForm, parent_group_id: e.target.value })}>
              <option value="">— None (top level) —</option>
              {groups.filter((g) => g.id !== groupForm.id).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
          <button
            type="button" disabled={busy || !groupForm.name.trim()}
            onClick={() => {
              const payload = { name: groupForm.name, reg_no: groupForm.reg_no, country_code: groupForm.country_code, notes: groupForm.notes, parent_group_id: groupForm.parent_group_id || null };
              if (groupForm.id) {
                run(() => platformApi.updateGroup(groupForm.id, payload).then(() => setGroupForm(emptyGroup)), 'Group updated.');
              } else {
                run(() => platformApi.createGroup(payload).then(() => setGroupForm(emptyGroup)), 'Group registered.');
              }
            }}
          >
            {groupForm.id ? 'Save Changes' : 'Register Group'}
          </button>
          {groupForm.id && <button type="button" onClick={() => setGroupForm(emptyGroup)}>Cancel</button>}
        </div>
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
              <tr key={c.id} style={c.is_active ? null : { background: '#FDECEC' }}>
                <td style={td}>
                  {c.name}
                  {!c.is_active && (
                    <div style={{ fontSize: 11, color: '#B23A3A' }}>
                      SUSPENDED{c.suspended_reason ? ` — ${c.suspended_reason}` : ''}
                    </div>
                  )}
                </td>
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
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  <button type="button" style={{ fontSize: 12, padding: '3px 8px', marginRight: 6 }} onClick={() => openUsersFor(c)}>
                    Users
                  </button>
                  <button
                    type="button" style={{ fontSize: 12, padding: '3px 8px', marginRight: 6 }}
                    onClick={() => setCompanyForm({ id: c.id, name: c.name, reg_no: c.reg_no || '', country_code: c.country_code || '', group_id: c.group_id || '', notes: c.notes || '' })}
                  >
                    Edit
                  </button>
                  {Number(c.user_count) === 0 && Number(c.event_count) === 0 && Number(c.exhibitor_count) === 0 && (
                    <button
                      type="button" style={{ fontSize: 12, padding: '3px 8px', marginRight: 6 }}
                      onClick={() => {
                        if (!window.confirm(`Delete "${c.name}"? This company has no users, events or exhibitors, so this is a real, unrecoverable delete — not a suspend.`)) return;
                        run(() => platformApi.deleteCompany(c.id), `${c.name} deleted.`);
                      }}
                    >
                      Delete
                    </button>
                  )}
                  {c.is_active ? (
                    <button
                      type="button" style={{ fontSize: 12, padding: '3px 8px', background: '#B23A3A' }}
                      onClick={() => {
                        const reason = window.prompt(
                          `Suspend "${c.name}"?\n\nEvery user of this company will be signed out immediately and unable to log back in. No data is deleted — reactivating restores everything.\n\nReason (required):`
                        );
                        if (reason === null) return;
                        if (!reason.trim()) { setError('A reason is required to suspend a company.'); return; }
                        run(() => platformApi.setCompanySuspension(c.id, false, reason.trim()), `${c.name} suspended.`);
                      }}
                    >
                      Suspend
                    </button>
                  ) : (
                    <button
                      type="button" style={{ fontSize: 12, padding: '3px 8px' }}
                      title={c.suspended_reason ? `Suspended: ${c.suspended_reason}` : undefined}
                      onClick={() => run(() => platformApi.setCompanySuspension(c.id, true), `${c.name} reactivated.`)}
                    >
                      Reactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {usersFor && (
        <div style={{ ...box, borderColor: '#185FA5' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <strong style={{ fontSize: 13 }}>Users at {usersFor.name}</strong>
            <button type="button" onClick={() => setUsersFor(null)}>Close</button>
          </div>

          {companyUsers.length > 0 && (
            <table width="100%" style={{ borderCollapse: 'collapse', marginTop: 8 }}>
              <thead><tr><th style={th}>Name</th><th style={th}>Email</th><th style={th}>Role</th><th style={th}></th></tr></thead>
              <tbody>
                {companyUsers.map((u) => (
                  <tr key={u.id}>
                    {editingUserId === u.id ? (
                      <>
                        <td style={td}><input style={{ ...input, padding: 4 }} value={userEditForm.full_name} onChange={(e) => setUserEditForm({ ...userEditForm, full_name: e.target.value })} /></td>
                        <td style={td}><input style={{ ...input, padding: 4 }} value={userEditForm.email} onChange={(e) => setUserEditForm({ ...userEditForm, email: e.target.value })} /></td>
                        <td style={td}>{u.role_name || '—'}</td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>
                          <button
                            type="button" style={{ fontSize: 12, padding: '3px 8px' }}
                            onClick={() => run(async () => {
                              await platformApi.updateCompanyUser(usersFor.id, u.id, userEditForm);
                              setEditingUserId(null);
                              openUsersFor(usersFor);
                            }, 'User updated.')}
                          >
                            Save
                          </button>{' '}
                          <button type="button" style={{ fontSize: 12, padding: '3px 8px' }} onClick={() => setEditingUserId(null)}>Cancel</button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={td}>{u.full_name}{!u.is_active && <span style={{ color: '#B23A3A', fontSize: 11 }}> (inactive)</span>}</td>
                        <td style={td}>{u.email}</td>
                        <td style={td}>{u.role_name || '—'}</td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>
                          <button
                            type="button" style={{ fontSize: 12, padding: '3px 8px' }}
                            onClick={() => { setEditingUserId(u.id); setUserEditForm({ email: u.email, full_name: u.full_name }); }}
                          >
                            Edit
                          </button>{' '}
                          <button
                            type="button" style={{ fontSize: 12, padding: '3px 8px' }}
                            onClick={() => {
                              if (!window.confirm(`Reset the password for ${u.email}? This is the "forgot password" recovery path — they'll need the new temporary password from you.`)) return;
                              run(async () => {
                                const { user } = await platformApi.resetCompanyUserPassword(usersFor.id, u.id);
                                window.alert(`Password reset for ${user.email}\n\nTemporary password: ${user.temp_password}\n\nSave this now — it is not shown again.`);
                              });
                            }}
                          >
                            Reset Password
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #f0f2f5' }}>
            <strong style={{ fontSize: 13 }}>
              {companyUsers.length === 0 ? 'Create first Admin' : 'Add another Admin'}
            </strong>
            {companyUsers.length === 0 && (
              <p style={{ fontSize: 12, color: '#5c6070' }}>
                Creates this tenant&rsquo;s first Admin account and shows a one-time temporary password.
                Everyone else is normally added by that Admin from inside the company — use this again only if
                every Admin account here is locked out.
              </p>
            )}
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
            <button
              type="button" disabled={busy || !adminForm.email.trim() || !adminForm.full_name.trim()} style={{ marginTop: 10 }}
              onClick={() => run(async () => {
                const { user } = await platformApi.createCompanyAdmin(usersFor.id, adminForm);
                window.alert(`Admin created for ${usersFor.name}\n\nEmail: ${user.email}\nTemporary password: ${user.temp_password}\n\nSave this now — it is not shown again.`);
                setAdminForm({ email: '', full_name: '' });
                openUsersFor(usersFor);
              })}
            >
              Create Admin
            </button>
          </div>
        </div>
      )}

      <div style={box}>
        <strong style={{ fontSize: 13 }}>{companyForm.id ? `Edit ${companyForm.name}` : 'Register a company'}</strong>
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
        {!companyForm.id && (
          <p style={{ fontSize: 12, color: '#5c6070', marginBottom: 0 }}>
            Registering also creates the starter setup every company needs — default roles, sales stages, aging buckets
            and settings — which the company then edits for itself.
          </p>
        )}
        <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
          <button
            type="button" disabled={busy || !companyForm.name.trim()}
            onClick={() => {
              if (companyForm.id) {
                run(() => platformApi.updateCompany(companyForm.id, companyForm).then(() => setCompanyForm(emptyCompany)), 'Company updated.');
              } else {
                run(() => platformApi.createCompany(companyForm).then(() => setCompanyForm(emptyCompany)), 'Company registered.');
              }
            }}
          >
            {companyForm.id ? 'Save Changes' : 'Register Company'}
          </button>
          {companyForm.id && <button type="button" onClick={() => setCompanyForm(emptyCompany)}>Cancel</button>}
        </div>
      </div>

      <h3 style={{ marginTop: 28 }}>Platform Activity</h3>
      <div style={box}>
        <p style={{ fontSize: 12, color: '#5c6070', marginTop: 0 }}>
          Every action taken from this console. Separate from each company&rsquo;s own Audit Log, and not visible to any
          tenant.
        </p>
        <table width="100%" style={{ borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>When</th><th style={th}>Who</th><th style={th}>Action</th><th style={th}>Company</th><th style={th}>Detail</th></tr></thead>
          <tbody>
            {audit.length === 0 && <tr><td style={td} colSpan={5}>Nothing recorded yet.</td></tr>}
            {audit.map((a) => (
              <tr key={a.id}>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{new Date(a.created_at).toLocaleString('en-MY')}</td>
                <td style={td}>{a.admin_email || '—'}</td>
                <td style={{ ...td, fontWeight: 600 }}>{a.action}</td>
                <td style={td}>{a.company_name || '—'}</td>
                <td style={{ ...td, fontSize: 12, color: '#5c6070' }}>
                  {a.details ? Object.entries(a.details).filter(([, v]) => v !== null && v !== undefined)
                    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ') : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
