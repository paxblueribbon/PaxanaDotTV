import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'

const POLL_MS = 4000

export default function Player({ channelKey, onBack }) {
  const videoRef   = useRef(null)
  const hlsRef     = useRef(null)
  const pollingRef = useRef(null)
  const mountedRef = useRef(true)
  const [status, setStatus] = useState('connecting') // 'connecting' | 'live' | 'interrupted' | 'ended'

  function safeSetStatus(s) {
    if (mountedRef.current) setStatus(s)
  }

  function destroyHls() {
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null }
  }

  function stopPolling() {
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null }
  }

  function attachHls() {
    destroyHls()
    safeSetStatus('connecting')

    const video  = videoRef.current
    const hlsUrl = `/hls/live/${encodeURIComponent(channelKey)}/index.m3u8`

    if (!Hls.isSupported()) {
      // Safari native HLS
      video.src = hlsUrl
      video.play().catch(() => {})
      safeSetStatus('live')
      return
    }

    const hls = new Hls({
      liveSyncDurationCount:    5,
      liveMaxLatencyDurationCount: 12,
      maxBufferLength:          60,
      backBufferLength:         30,
      lowLatencyMode:           false,
      xhrSetup(xhr) {
        xhr.setRequestHeader('Cache-Control', 'no-cache')
      },
    })
    hlsRef.current = hls

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      if (!mountedRef.current) return
      video.play().catch(() => {})
      safeSetStatus('live')
      stopPolling()
    })

    hls.on(Hls.Events.ERROR, (_, data) => {
      if (!data.fatal || !mountedRef.current) return
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        hls.recoverMediaError()
      } else {
        destroyHls()
        safeSetStatus('interrupted')
        startPolling()
      }
    })

    hls.loadSource(hlsUrl)
    hls.attachMedia(video)
  }

  async function checkStream() {
    try {
      const res  = await fetch(`/status/${encodeURIComponent(channelKey)}`)
      const data = await res.json()
      if (!mountedRef.current) return
      if (data.live) {
        stopPolling()
        attachHls()
      } else {
        stopPolling()
        safeSetStatus('ended')
        setTimeout(() => { if (mountedRef.current) onBack() }, 2000)
      }
    } catch (_) {}
  }

  function startPolling() {
    if (pollingRef.current) return
    checkStream()
    pollingRef.current = setInterval(checkStream, POLL_MS)
  }

  useEffect(() => {
    mountedRef.current = true
    attachHls()

    const video  = videoRef.current
    const unmute = () => { if (video) video.muted = false }
    document.addEventListener('click', unmute, { once: true })

    return () => {
      mountedRef.current = false
      destroyHls()
      stopPolling()
      document.removeEventListener('click', unmute)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const overlayMsg = {
    connecting:  'Connecting…',
    interrupted: 'Stream interrupted – reconnecting…',
    ended:       'Stream ended.',
  }[status]

  return (
    <div id="player-view" className="active">
      <button id="back-btn" onClick={onBack}>← All Channels</button>
      <div id="stage">
        <video ref={videoRef} id="player" autoPlay muted playsInline />
        <div id="live-badge" className={status === 'live' ? 'visible' : ''}>
          <div className="dot" />
          live
        </div>
        <div id="channel-label">{channelKey}</div>
        {status !== 'live' && (
          <div id="overlay">
            <div className="dot" />
            <div id="status-text">{overlayMsg}</div>
          </div>
        )}
      </div>
    </div>
  )
}
