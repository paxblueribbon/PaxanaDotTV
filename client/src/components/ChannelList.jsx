import { useState, useEffect } from 'react'

const POLL_MS = 4000

export default function ChannelList({ onWatch }) {
  const [channels, setChannels] = useState([])

  useEffect(() => {
    let cancelled = false

    async function refresh() {
      try {
        const res = await fetch('/channels')
        const data = await res.json()
        if (!cancelled) setChannels(data.channels)
      } catch (_) {}
    }

    refresh()
    const id = setInterval(refresh, POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  return (
    <div id="channel-list-view">
      <h2>Live Channels</h2>
      <div id="channel-list">
        {channels.length === 0
          ? <div id="no-channels">No streams are live right now.</div>
          : channels.map(ch => (
              <div key={ch.key} className="channel-item" onClick={() => onWatch(ch.key)}>
                <div className="dot" />
                <div className="channel-key">{ch.key}</div>
                <div className="watch-label">watch →</div>
              </div>
            ))
        }
      </div>
    </div>
  )
}
