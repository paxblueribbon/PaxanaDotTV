import { useState, useEffect } from 'react'

const POLL_MS = 4000

export default function ChannelList({ onWatch, isAdmin }) {
  const [channels, setChannels]   = useState([])
  const [launching, setLaunching] = useState(new Set())
  const [errors, setErrors]       = useState({}) // key → error message

  useEffect(() => {
    let cancelled = false

    async function refresh() {
      try {
        const res  = await fetch('/api/show-channels')
        const data = await res.json()
        if (!cancelled) setChannels(data.channels || [])
      } catch (_) {}
    }

    refresh()
    const id = setInterval(refresh, POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  async function handleLaunch(key) {
    setLaunching(s => new Set(s).add(key))
    setErrors(e => ({ ...e, [key]: null }))
    try {
      const res  = await fetch(`/api/show-channels/${key}/launch`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) setErrors(e => ({ ...e, [key]: data.error || 'Launch failed' }))
    } catch (err) {
      setErrors(e => ({ ...e, [key]: err.message }))
    }
    setLaunching(s => { const n = new Set(s); n.delete(key); return n })
  }

  async function handleStop(key) {
    await fetch(`/api/show-channels/${key}/stop`, { method: 'POST' })
  }

  const visible = isAdmin ? channels : channels.filter(ch => ch.live)

  return (
    <div id="channel-list-view">
      <h2>Live Channels</h2>
      <div id="channel-list">
        {visible.length === 0 && (
          <div id="no-channels">
            {isAdmin ? 'Add show folders to the shows/ directory.' : 'No channels are live right now.'}
          </div>
        )}
        {visible.map(ch => (
          <div key={ch.key}>
            <div className={`channel-item${ch.live ? '' : ch.waiting ? ' waiting' : ' offline'}`}>
              <div className={`ch-dot${ch.live ? ' live' : ch.waiting ? ' waiting' : ''}`} />

              <div className="channel-key">
                {ch.name}
                {isAdmin && !ch.obsOnly && (
                  <span className="ch-meta">{ch.episodeCount} episode{ch.episodeCount !== 1 ? 's' : ''}</span>
                )}
                {isAdmin && ch.obsOnly && (
                  <span className="ch-meta">OBS</span>
                )}
              </div>

              {ch.live ? (
                <div className="ch-actions">
                  <span className="watch-label" onClick={() => onWatch(ch.key)}>watch →</span>
                  {isAdmin && (
                    <button className="stop-btn" onClick={() => handleStop(ch.key)}>stop</button>
                  )}
                </div>
              ) : ch.waiting ? (
                <div className="ch-actions">
                  <span className="waiting-label">awaiting stream…</span>
                  {isAdmin && (
                    <button className="stop-btn" onClick={() => handleStop(ch.key)}>stop</button>
                  )}
                </div>
              ) : (
                isAdmin && (
                  <button
                    className="launch-btn"
                    onClick={() => handleLaunch(ch.key)}
                    disabled={launching.has(ch.key)}
                  >
                    {launching.has(ch.key) ? 'launching…' : 'launch →'}
                  </button>
                )
              )}
            </div>
            {isAdmin && errors[ch.key] && (
              <div className="ch-error">{errors[ch.key]}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
