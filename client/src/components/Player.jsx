import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'

const POLL_MS     = 4000
const MAX_RETRIES = 5
const RETRY_DELAY = 2000

function IconVolume() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
    </svg>
  )
}

function IconMuted() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
      <line x1="23" y1="9" x2="17" y2="15"/>
      <line x1="17" y1="9" x2="23" y2="15"/>
    </svg>
  )
}

function IconFullscreen() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
    </svg>
  )
}

function IconExitFullscreen() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 0 2-2h3M3 16h3a2 2 0 0 0 2 2v3"/>
    </svg>
  )
}

export default function Player({ channelKey, onBack }) {
  const videoRef      = useRef(null)
  const stageRef      = useRef(null)
  const hlsRef        = useRef(null)
  const pollingRef    = useRef(null)
  const retryTimerRef = useRef(null)
  const mountedRef    = useRef(true)
  const retriesRef    = useRef(0)
  const lastVolumeRef = useRef(1)

  const [status, setStatus]           = useState('connecting') // 'connecting' | 'live' | 'interrupted' | 'ended'
  const [volume, setVolume]           = useState(1)
  const [muted, setMuted]             = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)

  function safeSetStatus(s) {
    if (mountedRef.current) setStatus(s)
  }

  // ── Volume & fullscreen ───────────────────────────────────────────────────────
  function handleMuteToggle() {
    const video = videoRef.current
    if (!video) return
    if (muted) {
      const restore = lastVolumeRef.current
      video.volume = restore
      video.muted  = false
      setVolume(restore)
      setMuted(false)
    } else {
      lastVolumeRef.current = volume > 0 ? volume : 1
      video.muted = true
      setMuted(true)
    }
  }

  function handleVolumeChange(e) {
    const v = parseFloat(e.target.value)
    const video = videoRef.current
    if (!video) return
    if (v > 0) lastVolumeRef.current = v
    video.volume = v
    video.muted  = v === 0
    setVolume(v)
    setMuted(v === 0)
  }

  function handleFullscreen() {
    if (!document.fullscreenElement) {
      stageRef.current?.requestFullscreen().catch(() => {})
    } else {
      document.exitFullscreen().catch(() => {})
    }
  }

  // ── HLS connection ────────────────────────────────────────────────────────────
  function destroyHls() {
    if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null }
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null }
  }

  function stopPolling() {
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null }
  }

  function attachHls() {
    destroyHls()
    retriesRef.current = 0
    safeSetStatus('connecting')

    const video  = videoRef.current
    const hlsUrl = `/hls/live/${encodeURIComponent(channelKey)}/index.m3u8`

    if (!Hls.isSupported()) {
      video.src = hlsUrl
      video.play().catch(() => {})
      safeSetStatus('live')
      return
    }

    const hls = new Hls({
      liveSyncDurationCount:       3,   // target 3 segments (12s) behind live
      liveMaxLatencyDurationCount: 5,   // snap back if >5 segments (20s) behind — was 10 (40s)
      maxBufferLength:             20,  // 20s is plenty for live — was 60s
      backBufferLength:            0,   // no back buffer needed for live
      lowLatencyMode:              false,
      xhrSetup(xhr) { xhr.setRequestHeader('Cache-Control', 'no-cache') },
    })
    hlsRef.current = hls

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      if (!mountedRef.current) return
      retriesRef.current = 0
      video.play().catch(() => {})
      safeSetStatus('live')
      stopPolling()
    })

    hls.on(Hls.Events.ERROR, (_, data) => {
      if (!data.fatal || !mountedRef.current) return
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        hls.recoverMediaError(); return
      }
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && retriesRef.current < MAX_RETRIES) {
        retriesRef.current++
        retryTimerRef.current = setTimeout(() => {
          if (hlsRef.current) hlsRef.current.startLoad()
        }, RETRY_DELAY)
        return
      }
      retriesRef.current = 0
      destroyHls()
      safeSetStatus('interrupted')
      retryTimerRef.current = setTimeout(() => {
        if (mountedRef.current) startPolling()
      }, RETRY_DELAY)
    })

    hls.loadSource(hlsUrl)
    hls.attachMedia(video)
  }

  async function checkStream() {
    try {
      const res  = await fetch(`/status/${encodeURIComponent(channelKey)}`)
      const data = await res.json()
      if (!mountedRef.current) return
      if (data.live) { stopPolling(); attachHls() }
      else {
        stopPolling(); safeSetStatus('ended')
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

    function onFullscreenChange() {
      setIsFullscreen(!!document.fullscreenElement)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)

    return () => {
      mountedRef.current = false
      destroyHls()
      stopPolling()
      document.removeEventListener('fullscreenchange', onFullscreenChange)
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
      <div id="stage" ref={stageRef}>
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
        <div id="video-controls">
          <button className="ctrl-btn" onClick={handleMuteToggle} title={muted ? 'Unmute' : 'Mute'}>
            {(muted || volume === 0) ? <IconMuted /> : <IconVolume />}
          </button>
          <input
            id="volume-slider"
            type="range" min="0" max="1" step="0.01"
            value={muted ? 0 : volume}
            onChange={handleVolumeChange}
          />
          <button id="fullscreen-ctrl" className="ctrl-btn" onClick={handleFullscreen} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
            {isFullscreen ? <IconExitFullscreen /> : <IconFullscreen />}
          </button>
        </div>
      </div>
    </div>
  )
}
