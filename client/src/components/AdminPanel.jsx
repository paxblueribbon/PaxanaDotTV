import { useState, useEffect, useRef } from 'react'

const STATUS_LABELS = { pending: 'pending', noted: 'noted', dismissed: 'dismissed' }

function TagRow({ item, type, onSaved, allTags }) {
  const [draft,  setDraft]  = useState(item.tags.join(', '))
  const [saving, setSaving] = useState(false)
  const [sugs,   setSugs]   = useState([])
  const inputRef            = useRef(null)

  function handleChange(e) {
    const val     = e.target.value
    setDraft(val)
    const parts   = val.split(',')
    const partial = parts[parts.length - 1].trim().toLowerCase()
    if (partial) {
      const already = new Set(parts.slice(0, -1).map(t => t.trim().toLowerCase()))
      setSugs(allTags.filter(t => t.startsWith(partial) && !already.has(t)).slice(0, 6))
    } else {
      setSugs([])
    }
  }

  function applySug(tag) {
    const parts    = draft.split(',').slice(0, -1)
    const newDraft = [...parts, ' ' + tag].join(',').replace(/^[\s,]+/, '') + ', '
    setDraft(newDraft)
    setSugs([])
    inputRef.current?.focus()
  }

  async function save() {
    setSaving(true)
    setSugs([])
    const tags = draft.split(',').map(t => t.trim()).filter(Boolean)
    await fetch(`/api/admin/${type === 'movie' ? 'movies' : 'shows'}/${item.id}/tags`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ tags }),
    })
    setSaving(false)
    onSaved()
  }

  return (
    <div className="tag-row">
      <span className="tag-row-title">{item.title}</span>
      <div className="tag-row-input-wrap">
        <input
          ref={inputRef}
          className="tag-row-input"
          value={draft}
          onChange={handleChange}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setSugs([]) }}
          onBlur={() => setTimeout(() => setSugs([]), 150)}
          placeholder="comma-separated tags"
        />
        {sugs.length > 0 && (
          <ul className="tag-suggestions">
            {sugs.map(s => <li key={s} onMouseDown={() => applySug(s)}>{s}</li>)}
          </ul>
        )}
      </div>
      <button className="tag-row-save" onClick={save} disabled={saving}>
        {saving ? '…' : 'save'}
      </button>
    </div>
  )
}

function timeAgo(isoString) {
  const ms   = Date.now() - new Date(isoString + 'Z').getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 60)  return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function fmt(bytes) {
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB'
  return (bytes / 1048576).toFixed(0) + ' MB'
}

function fmtUptime(seconds) {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function StatBar({ pct, warn = 60, danger = 85 }) {
  const color = pct >= danger ? '#e05252' : pct >= warn ? '#e09c2f' : '#4caf7d'
  return (
    <div className="stat-bar-track">
      <div className="stat-bar-fill" style={{ width: `${pct.toFixed(1)}%`, background: color }} />
    </div>
  )
}

export default function AdminPanel({ user }) {
  const [users, setUsers]           = useState([])
  const [inviteRole, setInviteRole] = useState('user')
  const [inviteUrl, setInviteUrl]   = useState(null)
  const [busy, setBusy]             = useState(false)
  const [error, setError]           = useState('')

  const [recs, setRecs]             = useState([])
  const [recFilter, setRecFilter]   = useState('pending')

  const [tagSection,  setTagSection]  = useState('movies')
  const [tagMovies,   setTagMovies]   = useState([])
  const [tagShows,    setTagShows]    = useState([])

  const [stats, setStats] = useState(null)

  useEffect(() => { loadUsers(); loadRecs(); loadTagItems() }, [])

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch('/api/admin/stats')
        if (res.ok) setStats(await res.json())
      } catch {}
    }
    fetchStats()
    const interval = setInterval(fetchStats, 5000)
    return () => clearInterval(interval)
  }, [])

  async function loadUsers() {
    const res  = await fetch('/api/admin/users')
    const data = await res.json()
    if (res.ok) setUsers(data.users)
  }

  async function loadTagItems() {
    const [mr, sr] = await Promise.all([fetch('/movies.json'), fetch('/tv.json')])
    const [md, sd] = await Promise.all([mr.json(), sr.json()])
    setTagMovies(md.movies ?? [])
    setTagShows(sd.shows   ?? [])
  }

  async function loadRecs() {
    const res  = await fetch('/api/admin/recommendations')
    const data = await res.json()
    if (res.ok) setRecs(data.recommendations)
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

  async function setRecStatus(id, status) {
    await fetch(`/api/admin/recommendations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    loadRecs()
  }

  async function deleteRec(id) {
    await fetch(`/api/admin/recommendations/${id}`, { method: 'DELETE' })
    loadRecs()
  }

  const pendingCount  = recs.filter(r => r.status === 'pending').length
  const visibleRecs   = recs.filter(r => r.status === recFilter)
  const allTags       = [...new Set([...tagMovies, ...tagShows].flatMap(item => item.tags ?? []))].sort()

  return (
    <div id="admin-panel">

      {/* ── Server Stats ── */}
      <section id="admin-stats-section">
        <h2 className="admin-heading">server health</h2>
        {stats ? (
          <div className="stats-grid">
            <div className="stat-card">
              <span className="stat-label">cpu load</span>
              <StatBar pct={stats.cpuLoadPct} />
              <span className="stat-value">{stats.cpuLoadPct.toFixed(1)}% <span className="stat-sub">({stats.loadAvg1m.toFixed(2)} avg / {stats.cpuCount} cores)</span></span>
            </div>
            <div className="stat-card">
              <span className="stat-label">memory</span>
              <StatBar pct={stats.memUsedPct} />
              <span className="stat-value">{fmt(stats.memUsed)} / {fmt(stats.memTotal)} <span className="stat-sub">({stats.memUsedPct.toFixed(1)}%)</span></span>
            </div>
            <div className="stat-card stat-card--inline">
              <span className="stat-label">uptime</span>
              <span className="stat-value">{fmtUptime(stats.uptime)}</span>
            </div>
            <div className="stat-card stat-card--inline">
              <span className="stat-label">active streams</span>
              <span className={`stat-value${stats.activeStreams > 0 ? ' stat-live' : ''}`}>{stats.activeStreams}</span>
            </div>
          </div>
        ) : (
          <p className="admin-hint">Loading…</p>
        )}
      </section>

      {/* ── Recommendations ── */}
      <section id="admin-recs-section">
        <h2 className="admin-heading">
          recommendations
          {pendingCount > 0 && <span className="pending-badge">{pendingCount}</span>}
        </h2>

        <div className="rec-filter-tabs">
          {['pending', 'noted', 'dismissed'].map(s => (
            <button
              key={s}
              className={`rec-filter-btn${recFilter === s ? ' active' : ''}`}
              onClick={() => setRecFilter(s)}
            >
              {STATUS_LABELS[s]}
              <span className="rec-filter-count">{recs.filter(r => r.status === s).length}</span>
            </button>
          ))}
        </div>

        {visibleRecs.length === 0 ? (
          <p className="admin-hint" style={{ marginTop: '0.75rem' }}>No {recFilter} recommendations.</p>
        ) : (
          <div className="rec-list">
            {visibleRecs.map(r => (
              <div key={r.id} className="rec-item">
                <div className="rec-meta">
                  <span className={`rec-type-badge ${r.type}`}>{r.type === 'show' ? 'tv' : 'movie'}</span>
                  <span className="rec-title">{r.title}</span>
                  {r.tmdb_id && <span className="rec-tmdb">tmdb:{r.tmdb_id}</span>}
                </div>
                <div className="rec-sub">
                  <span className="rec-who">by {r.submitted_by_name}</span>
                  <span className="rec-when">{timeAgo(r.created_at)}</span>
                </div>
                {r.note && <p className="rec-note">"{r.note}"</p>}
                <div className="rec-actions">
                  {r.status !== 'noted'     && <button className="rec-btn" onClick={() => setRecStatus(r.id, 'noted')}>note</button>}
                  {r.status !== 'pending'   && <button className="rec-btn" onClick={() => setRecStatus(r.id, 'pending')}>mark pending</button>}
                  {r.status !== 'dismissed' && <button className="rec-btn rec-dismiss" onClick={() => setRecStatus(r.id, 'dismissed')}>dismiss</button>}
                  <button className="rec-btn rec-delete" onClick={() => deleteRec(r.id)}>delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Tags ── */}
      <section id="admin-tags-section">
        <h2 className="admin-heading">content tags</h2>
        <div className="rec-filter-tabs">
          {[['movies', 'movies'], ['shows', 'tv shows']].map(([key, label]) => (
            <button
              key={key}
              className={`rec-filter-btn${tagSection === key ? ' active' : ''}`}
              onClick={() => setTagSection(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="tag-list">
          {(tagSection === 'movies' ? tagMovies : tagShows).map(item => (
            <TagRow
              key={`${tagSection}-${item.id}`}
              item={item}
              type={tagSection === 'movies' ? 'movie' : 'show'}
              onSaved={loadTagItems}
              allTags={allTags}
            />
          ))}
        </div>
      </section>

      {/* ── Users ── */}
      <section id="admin-users-section">
        <h2 className="admin-heading">users</h2>
        <table id="admin-users-table">
          <thead>
            <tr>
              <th>username</th>
              <th>role</th>
              <th>joined</th>
              <th>last login</th>
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
                <td>{u.last_login_at ? new Date(u.last_login_at + 'Z').toLocaleDateString() : <span className="muted">—</span>}</td>
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

      {/* ── Invite ── */}
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
