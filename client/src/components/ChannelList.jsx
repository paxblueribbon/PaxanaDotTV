import { useState, useEffect } from 'react'

const POLL_MS = 4000

export default function ChannelList({ onWatch }) {
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

  return (
    <div id="channel-list-view">
      <h2>Live Channels</h2>
      <div id="channel-list">
        {channels.length === 0 && (
          <div id="no-channels">Add show folders to the <code>shows/</code> directory.</div>
        )}
        {channels.map(ch => (
          <div key={ch.key}>
            <div className={`channel-item${ch.live ? '' : ' offline'}`}>
              <div className={`ch-dot${ch.live ? ' live' : ''}`} />

              <div className="channel-key">
                {ch.name}
                <span className="ch-meta">{ch.episodeCount} episode{ch.episodeCount !== 1 ? 's' : ''}</span>
              </div>

              {ch.live ? (
                <div className="ch-actions">
                  <span className="watch-label" onClick={() => onWatch(ch.key)}>watch →</span>
                  <button className="stop-btn" onClick={() => handleStop(ch.key)}>stop</button>
                </div>
              ) : (
                <button
                  className="launch-btn"
                  onClick={() => handleLaunch(ch.key)}
                  disabled={launching.has(ch.key)}
                >
                  {launching.has(ch.key) ? 'launching…' : 'launch →'}
                </button>
              )}
            </div>
            {errors[ch.key] && (
              <div className="ch-error">{errors[ch.key]}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
