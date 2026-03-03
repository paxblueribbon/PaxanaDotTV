import { useState, useEffect } from 'react'

export default function AdminPanel({ user }) {
  const [users, setUsers]           = useState([])
  const [inviteRole, setInviteRole] = useState('user')
  const [inviteUrl, setInviteUrl]   = useState(null)
  const [busy, setBusy]             = useState(false)
  const [error, setError]           = useState('')

  useEffect(() => { loadUsers() }, [])

  async function loadUsers() {
    const res  = await fetch('/api/admin/users')
    const data = await res.json()
    if (res.ok) setUsers(data.users)
  }

  async function generateInvite() {
    setBusy(true)
    setError('')
    setInviteUrl(null)
    try {
      const res  = await fetch('/api/admin/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: inviteRole }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create invite')
      setInviteUrl(data.url)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function removeUser(id, username) {
    if (!confirm(`Remove user "${username}"? This cannot be undone.`)) return
    const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' })
    if (res.ok) loadUsers()
    else {
      const data = await res.json()
      setError(data.error || 'Failed to remove user')
    }
  }

  return (
    <div id="admin-panel">
      <section id="admin-users-section">
        <h2 className="admin-heading">users</h2>
        <table id="admin-users-table">
          <thead>
            <tr>
              <th>username</th>
              <th>role</th>
              <th>joined</th>
              <th>invited by</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td>{u.username}{u.id === user.id ? <span className="you-tag"> (you)</span> : null}</td>
                <td><span className={`role-badge ${u.role}`}>{u.role}</span></td>
                <td>{new Date(u.created_at + 'Z').toLocaleDateString()}</td>
                <td>{u.invited_by_name || <span className="muted">—</span>}</td>
                <td>
                  {u.id !== user.id && (
                    <button className="admin-remove-btn" onClick={() => removeUser(u.id, u.username)}>
                      remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section id="admin-invite-section">
        <h2 className="admin-heading">invite user</h2>
        <div className="invite-row">
          <select
            value={inviteRole}
            onChange={e => { setInviteRole(e.target.value); setInviteUrl(null) }}
            disabled={busy}
            className="invite-role-select"
          >
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
          <button className="invite-generate-btn" onClick={generateInvite} disabled={busy}>
            {busy ? '…' : 'generate invite link'}
          </button>
        </div>

        {inviteUrl && (
          <div className="invite-result">
            <input
              readOnly
              value={inviteUrl}
              className="invite-url-input"
              onClick={e => e.target.select()}
            />
            <button
              className="invite-copy-btn"
              onClick={() => navigator.clipboard.writeText(inviteUrl)}
            >
              copy
            </button>
          </div>
        )}

        {error && <p className="admin-error">{error}</p>}
        <p className="admin-hint">Invite links expire after 72 hours.</p>
      </section>
    </div>
  )
}
